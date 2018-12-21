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
const __load_app = process.argv.length === 3 ? process.argv[2] : '11be';

const loadConfig = (path) =>
{
        let buffer = fs.readFileSync(path);
        return JSON.parse(buffer.toString());
}

const bladeWorker = (rootcfg) =>
{
        let gethcfg = rootcfg.configDir !== '' ? loadConfig(path.join(rootcfg.configDir, 'config.json')) : {};
        let ipfscfg = rootcfg.configDir !== '' ? loadConfig(path.join(rootcfg.configDir, 'ipfsserv.json')) : {};
        let cfgObjs = {geth: gethcfg, ipfs: ipfscfg};
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
	} else {
		BIApi = require('bladeiron_api');
		appOpts = {
			"appName": "be",
	                "artifactDir": __dirname,
	                "conditionDir": __dirname,
	                "contracts": [],
	                "networkID": gethcfg.networkID,
	                "version": "1.0" 
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
        let rpchost = gethcfg.rpchost || '127.0.0.1';
	
	return cluster.fork({rpcport, rpchost});
}

const askMasterPass = (resolve, reject) => 
{
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	try {
		rl.question('Master Password:', (answer) => {
  			rl.close();
			resolve(answer);
		});
		rl._writeToOutput = (stringToWrite) => { rl.output.write("*"); };
	} catch(err) {
		reject(err);
	}
}

// Main
cluster.setupMaster({exec: require.resolve('BladeIron/index.js')}); //BladeIron RPCServ

let rootcfg = loadConfig(path.join(".local","bootstrap_config.json"));
let stage   = Promise.resolve();
let worker  = initBIServer(rootcfg); 
let app, r, appName;

if (rootcfg.configDir !== '') {
	if (cluster.isMaster) {
		let slogan = "11BE Dev Console";
		app = bladeWorker(rootcfg);
		appName = app.cfgObjs.appOpts.appName;
		stage = stage.then(() => { return app[appName].connectRPC() });
		stage = stage.then(() => { return app[appName].client.call('fully_initialize', app.cfgObjs); });
		if (appName !== 'be') {
			slogan = appName;
			if (typeof(app.cfgObjs.appOpts.account) !== 'undefined') {
				stage = stage.then(() => { return new Promise(askMasterPass); });
				stage = stage.then((answer) => { 
					return app[appName].client.call('unlock', [answer]).then((rc) => 
					{
						if (!rc) {
							console.log("Warning: wrong password");
							process.exit(1);
						}
					}).then(() => {
						return app[appName].init(); 
					})
				});
			} else {
				console.log(`Warning: Read-only mode, need to unlock master password to change state.`);
				stage = stage.then(() => { 
					return app[appName].init(); 
				});
			} 
		} else {
			console.log(`Warning: Read-only mode, need to unlock master password to change state.`);
		}
		stage = stage.then(() => 
		{  
			 return ASCII_Art(slogan).then((art) => {
		          		console.log(art);
					r = repl.start({ prompt: `[-= ${slogan} =-]$ `, eval: replEvalPromise });
					r.context = {app};
				       	r.on('exit', () => {
				       		console.log("\n\t" + 'Stopping CLI...');
						app[appName].client.close();
						worker.kill('SIGINT');
				       	});
		       		});
		});
	}
} else {
	throw "Please setup bootstrap config first ..."; 
}
