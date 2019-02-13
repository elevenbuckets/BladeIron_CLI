#!/usr/bin/env node
'use strict';

const path = require('path');
const url = require('url');
const fs = require('fs');
const cluster = require('cluster');
const WSClient = require('rpc-websockets').Client;
const repl = require('repl');
const figlet = require('figlet');
const readline = require('readline');

// App or 11BE base
const __load_app = process.argv.length >= 3 ? process.argv[2] : '11be';
const __rt_opts  = process.argv.length === 4 ? process.argv[3].split(',').map((o) => { let kv = o.split(':'); return {[kv[0]]: kv[1]} }) : [{}];

const loadConfig = (path) =>
{
        let buffer = fs.readFileSync(path);
        return JSON.parse(buffer.toString());
}

const bladeWorker = (rootcfg) =>
{
        let gethcfg = rootcfg.configDir !== '' ? loadConfig(path.join(rootcfg.configDir, 'config.json')) : {};
        let ipfscfg = rootcfg.configDir !== '' ? loadConfig(path.join(rootcfg.configDir, 'ipfsserv.json')) : {};
        let tk20cfg = rootcfg.configDir !== '' ? loadConfig(path.join(rootcfg.configDir, 'Tokens.json')) : {};
        let cfgObjs = {geth: {...gethcfg, Tokens: tk20cfg}, ipfs: ipfscfg};
        let rpcport = gethcfg.rpcport || 3000;
        let rpchost = gethcfg.rpchost || '127.0.0.1';
        //let wsrpc   = new WSClient('ws://' + rpchost + ':' + rpcport);
	let output  = {cfgObjs};
	let BIApi;
	let appOpts
	
	//console.log(`DEBUG: __load_app = ${__load_app}`);
	if (__load_app !== '11be') { // FIXME: better app folder structure needed.
                BIApi = require(path.join(process.env.PWD, 'dapps', __load_app, __load_app + '.js'));
                appOpts = require(path.join(process.env.PWD, 'dapps', __load_app, __load_app + '.json'));
		if (appOpts.appName == 'be') throw "Invalid App Name which uses preserved words";
		__rt_opts.map((i) => { appOpts = { ...appOpts, ...i }})
	} else {
		BIApi = require('bladeiron_api');
		appOpts = {
			"appName": "be",
	                "artifactDir": __dirname,
	                "conditionDir": __dirname,
	                "contracts": [],
	                "networkID": gethcfg.networkID,
	                "version": "1.0",
			"serverOnly": true  // to re-enable basic 11BE dev console, remove this key or turn it into false
		}
	}

	output.cfgObjs = {...output.cfgObjs, appOpts};
	output[appOpts.appName] = new BIApi(rpcport, rpchost, appOpts);

	return output;
}

// ASCII Art!!!
const ASCII_Art = (word) => {
        const _aa = (resolve, reject) => {
                figlet(word, {font: 'Big'}, (err, data) => {
                        if (err) return reject(err);
                        resolve(data);
                })
        }

        return new Promise(_aa);
}

// Handling promises in REPL (for node < 10.x)
const replEvalPromise = (cmd,ctx,filename,cb) => {
  let result=eval(cmd);
  if (result instanceof Promise) {
    return result.then(response=>cb(null,response));
  }
  return cb(null, result);
}

const initBIServer = (rootcfg) => {
        let gethcfg = rootcfg.configDir !== '' ? loadConfig(path.join(rootcfg.configDir, 'config.json')) : {};
        let ipfscfg = rootcfg.configDir !== '' ? loadConfig(path.join(rootcfg.configDir, 'ipfsserv.json')) : {};
        let cfgObjs = {geth: gethcfg, ipfs: ipfscfg};
        let rpcport = gethcfg.rpcport || 3000;
        let rpchost = gethcfg.rpchost || process.env.rpchost || '127.0.0.1';
	
	return cluster.fork({rpcport, rpchost});
}

const askMasterPass = (resolve, reject) => 
{
	let pslen = 0;
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: true
	});
	try {
                rl.question('Master Password:', (answer) => {
                        rl.close();
                        resolve(answer);
                });
                rl._writeToOutput = (stringToWrite) => {
			//console.log(stringToWrite.charCodeAt(0));
			if (stringToWrite.charCodeAt(0) === 13) { 
				rl.output.write("\n");
			} else if (stringToWrite.charCodeAt(0) === 77 || stringToWrite.charCodeAt(0) === '') {
				if (pslen > 0) {
					pslen--;
					rl.output.write("Master Password:" + '*'.repeat(pslen));
				} else {
					rl.output.write("Master Password:");
				}
			} else {
				pslen++;
				rl.output.write("*"); 
			}
		};
	} catch(err) {
		reject(err);
	}
}

// Main
cluster.setupMaster({exec: require.resolve('BladeIron/index.js')}); //BladeIron RPCServ

let rootcfg = loadConfig(path.join(".local","bootstrap_config.json"));
let stage   = Promise.resolve();
let worker  = __load_app === '11be' ? initBIServer(rootcfg) : {}; 
let app, r, appName;

if (cluster.isMaster) {
	let slogan = "11BE Dev Console";
	app = bladeWorker(rootcfg);
	appName = app.cfgObjs.appOpts.appName;

	if (appName === 'be' && typeof(app.cfgObjs.appOpts.serverOnly) !== 'undefined' && app.cfgObjs.appOpts.serverOnly === true) {
		 return ASCII_Art('11BE: BladeIron Service').then((art) => {
	          		console.log(art);
				r = repl.start({ prompt: ``, eval: () => { console.log(art) } });
				r.context = {app};
			       	r.on('exit', () => {
			       		console.log("\n\t" + 'Stopping Services...');
					worker.kill('SIGINT');
			       	});
	       		});
	}

	// the following are for appName !== 'be'
	if (rootcfg.configDir !== '' || (appName === 'ControlPanel' && app.cfgObjs.appOpts.initSetup === 'true') ) {
		if (appName === 'ControlPanel' && app.cfgObjs.appOpts.initSetup === 'true') return app.[appName].launchGUI();

		stage = stage.then(() => { return app[appName].connectRPC() });
		stage = stage.then(() => { return app[appName].client.call('fully_initialize', app.cfgObjs); });

		slogan = appName;
		if (typeof(app.cfgObjs.appOpts.account) !== 'undefined') {
			stage = stage.then(() => { return new Promise(askMasterPass).catch((err) => { process.exit(1); }) });
			stage = stage.then((answer) => { 
				return app[appName].client.call('unlock', [answer]).then((rc) => 
				{
					if (!rc) {
						console.log("Warning: wrong password");
						process.exit(1);
					}
				}).then(() => {
					app[appName].linkAccount(app.cfgObjs.appOpts.account);
					let condType = app.cfgObjs.appOpts.condType || 'Sanity';
					return app[appName].init(condType); 
				})
			});
		} else {
			console.log(`Warning: Read-only mode, need to unlock master password to change state.`);
			stage = stage.then(() => { 
				return app[appName].init(); 
			});
		} 

		stage = stage.then(() => 
		{  
			 return ASCII_Art(slogan).then((art) => {
		          		console.log(art);
					if (typeof(app.cfgObjs.appOpts.autoGUI) !== 'undefined' && app.cfgObjs.appOpts.autoGUI === true) {
						app[appName].client.close();
						app[appName].launchGUI();
					} else {
						r = repl.start({ prompt: `[-= ${slogan} =-]$ `, eval: replEvalPromise });
						r.context = {app};
					       	r.on('exit', () => {
					       		console.log("\n\t" + 'Stopping CLI...');
							app[appName].client.close();
					       	});
					}
		       		});
		});
	} else {
		// trigger 11BE ControlPanel setup page
		const { exec } = require('child_process'); 
		exec('./node_modules/.bin/bladecli ControlPanel initSetup:true', 
		{
			cwd: path.join(process.env.PWD), 
			env: {DISPLAY: process.env.DISPLAY, XAUTHORITY: process.env.XAUTHORITY,  PATH: process.env.PATH} 
		});
	}
}
