/**
* Copyright (c) 2015-present, Facebook, Inc.
* All rights reserved.
*
* This source code is licensed under the BSD-style license found in the
* LICENSE file in the root directory of this source tree. An additional grant
* of patent rights can be found in the PATENTS file in the same directory.
*/
'use strict';

const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const findXcodeProject = require('./findXcodeProject');
const findReactNativeScripts = require('./findReactNativeScripts');
const parseIOSDevicesList = require('./parseIOSDevicesList');
const findMatchingSimulator = require('./findMatchingSimulator');
const cpp = require('child-process-promise');
const inquirer = require("inquirer")
const getBuildPath = function(configuration = 'Debug', appName, isDevice) {
  return `build/Build/Products/${configuration}-${isDevice ? 'iphoneos' : 'iphonesimulator'}/${appName}.app`;
};
const xcprettyAvailable = function() {
  try {
    child_process.execSync('xcpretty --version', {
      stdio: [ 0, 'pipe', 'ignore', ]
    });
  } catch (error) {
    return false;
  }
  return true;
};
var homeinfo = {};
const homefile = process.env.HOME + "/.rninfo";

function runIOS(argv, config, args) {
  var devteam = null; 
  if (!fs.existsSync(args.projectPath)) {
    const reactNativeScriptsPath = findReactNativeScripts();
    if (reactNativeScriptsPath) {
      child_process.spawnSync(
        reactNativeScriptsPath,
        ['ios'].concat(process.argv.slice(1)),
        {stdio: 'inherit'}
      );
      return;
    } else {
      throw new Error('iOS project folder not found. Are you sure this is a React Native project?');
    }
  }
  process.chdir(args.projectPath);
  const xcodeProject = findXcodeProject(fs.readdirSync('.'));
  if (!xcodeProject) {
    throw new Error('Could not find Xcode project files in ios folder');
  }

  const inferredSchemeName = path.basename(xcodeProject.name, path.extname(xcodeProject.name));
  const scheme = args.scheme || inferredSchemeName;
  console.log(`Found Xcode ${xcodeProject.isWorkspace ? 'workspace' : 'project'} ${xcodeProject.name}`);
  const devices = parseIOSDevicesList(
    child_process.execFileSync('xcrun', ['instruments', '-s'], {encoding: 'utf8'})
  );
  if(args.developmentTeam) {
    if(fs.existsSync(homefile)) {
      homeinfo = JSON.parse(fs.readFileSync(homefile))
    } else {
      homeinfo = {};
    }
    if(homeinfo.devteam && (args.developmentTeam === true || !args.developmentTeam.length)) {
        console.log("Using saved development team:", homeinfo.devteam);
        devteam = homeinfo.devteam; 
    } else if(args.developmentTeam.length != 10) {
      getFromDevTeams(homeinfo.devteams).then((devteam)=>{
        if(!devteam) {
          console.log("I did not get a development team I can use - aborting")
          process.exit(1); 
        }
        args.developmentTeam = devteam;
        process.chdir("../");        
        runIOS(argv, config, args);
      }, (error)=>{});
      return false;
    } else {
      devteam = args.developmentTeam
      if(homeinfo.devteam != devteam) {
        console.log("Saving development team to cache for future use:", devteam);
        console.log("Next time, running --development-team without argument will use this saved value.")
        homeinfo.devteam = devteam;
        fs.writeFileSync(homefile, JSON.stringify(homeinfo));
      }
    }
  }
  if (args.device) {
    const selectedDevice = matchingDevice(devices, args.device);
    if (selectedDevice) {
      return runOnDevice(selectedDevice, scheme, xcodeProject, args.configuration, args.packager, args.verbose, devteam);
    } else {
      if (devices && devices.length > 0) {
        console.log('Could not find device with the name: "' + args.device + '".');
        console.log('Choose one of the following:');
        printFoundDevices(devices);
      } else {
        console.log('No iOS devices connected.');
      }
    }
  } else if (args.udid) {
    return runOnDeviceByUdid(args, scheme, xcodeProject, devices, devteam);
  } else {
    return runOnSimulator(xcodeProject, args, scheme);
  }
}
function getFromDevTeams(devteams) {
  return new Promise((resolve, reject) => {
    if(!devteams) {
      resolve(getFromSearch())
    } else {
      inquirer.prompt([{
        "name": "devteam",
        "message": "Which development team do you want to use?",
        "type": "list",
        "choices": [...homeinfo.devteams, "None of these"]
      }]).then((answers)=>{
        if(answers.devteam == "None of these") {
          resolve(getFromSearch());
        } else {
          resolve(saveDefaultTeam(answers.devteam));          
        }
      },(error)=>{});
    }
  });
}
function saveDefaultTeam(devteam) {
  console.log("Checking to save default team", devteam);
  return new Promise((resolve, reject) => {
    inquirer.prompt([{
      "name": "dosave",
      "type": "confirm",
      "message": "Would you like to save this choice so that I use it by default when passing --development-team without arguments next time?"
    }]).then((answers)=>{
      if(answers.dosave) {
        homeinfo.devteam = devteam;
        fs.writeFileSync(homefile, JSON.stringify(homeinfo));
        console.log("Using this devteam and saving it to be default next time", devteam);       
      }
      resolve(devteam);  
    })
  })
}
function getFromSearch() {
  return new Promise((resolve, reject)=> {
    inquirer.prompt([{
      name: "searchortype",
      message: "Would you like me to search for a valid development team for you?",
      type:"confirm"
    }]).then((answers)=>{
      if(!answers.searchortype) {
        resolve(getFromTyping());
      } else {
        const homedir = process.env.HOME;
        inquirer.prompt([{
          "name": "basedir",
          "message": "Where should I search for your existing XCode projects?",
          "default": homedir,
          "validate": (answer)=>{return answer && fs.existsSync(answer);}
        }]).then((answers)=>{
          const command  = "find " + answers.basedir + " | grep -m500 \"project\\.pbxproj\" | xargs -L1 -JABC grep \"evelopmentTeam\" \"ABC\" 2>/dev/null | sort | uniq";
          console.log("\nLooking for development teams...")
          cpp.exec(command, {encoding: "utf8"}).then((out)=>{
            const lines = out.stdout.split("\n");
            const trimmed = lines.map((line)=>{return line.trim()}).filter((line)=>{return line.startsWith("DevelopmentTeam")}).map((line)=>{var x= line.trim(); x= x.substring(0,x.length - 1); x = x.substring(18); return x.trim();})
            if(trimmed.length) {
              //Always save these defaults
              homeinfo.devteams = trimmed;
              fs.writeFileSync(homefile, JSON.stringify(homeinfo));
              inquirer.prompt([{
                "name": "devteam",
                "message": "Which development team do you want to use?",
                "type": "list",
                "choices": [...homeinfo.devteams, "None of these"]
              }]).then((answers)=>{
                if(answers.devteam == "None of these") {
                  resolve(getFromTyping()); 
                } else {
                  resolve(saveDefaultTeam(answers.devteam));                  
                }
              },(error)=>{});
            } else {
              console.log("I found no  development teams, let's try typing.")
              resolve(getFromTyping());
            }
          });
        });
      }
    });
  });
}
function getFromTyping() {
  return new Promise((resolve, reject)=>{
    inquirer.prompt([{
      name: 'devteam',
      message: "What 10-digit development team ID do you want to use?",
      validate: (answer)=>{
        if(!answer) {
          console.log("I need a development team ID to continue")
          return false
        } else if (answer.length != 10) {
          console.log("A valid development team ID is 10 digits long. this was not. Try again?")
          return false
        } else {
          return true;
        }
      }
    }]).then((answers)=>{
      resolve(saveDefaultTeam(answers.devteam));
    }, (error)=>{
      console.log("This did not work",error)
    })  
  })
}
    
function runOnDeviceByUdid(args, scheme, xcodeProject, devices, devteam) {
  const selectedDevice = matchingDeviceByUdid(devices, args.udid);
  if (selectedDevice) {
    return runOnDevice(selectedDevice, scheme, xcodeProject, args.configuration, args.packager, args.verbose, devteam);
  } else {
    if (devices && devices.length > 0) {
      console.log('Could not find device with the udid: "' + args.udid + '".');
      console.log('Choose one of the following:');
      printFoundDevices(devices);
    } else {
      console.log('No iOS devices connected.');
    }
  }
}

function runOnSimulator(xcodeProject, args, scheme) {
  return new Promise((resolve) => {
    try {
      var simulators = JSON.parse(
      child_process.execFileSync('xcrun', ['simctl', 'list', '--json', 'devices'], {encoding: 'utf8'})
      );
    } catch (e) {
      throw new Error('Could not parse the simulator list output');
    }

    const selectedSimulator = findMatchingSimulator(simulators, args.simulator);
    if (!selectedSimulator) {
      throw new Error(`Could not find ${args.simulator} simulator`);
    }

    const simulatorFullName = formattedDeviceName(selectedSimulator);
    console.log(`Launching ${simulatorFullName}...`);
    try {
      child_process.spawnSync('xcrun', ['instruments', '-w', selectedSimulator.udid]);
    } catch (e) {
      // instruments always fail with 255 because it expects more arguments,
      // but we want it to only launch the simulator
    }
    resolve(selectedSimulator.udid);
  })
  .then((udid) => buildProject(xcodeProject, udid, scheme, args.configuration, args.packager, args.verbose))
  .then((appName) => {
    if (!appName) {
      appName = scheme;
    }
    let appPath = getBuildPath(args.configuration, appName);
    console.log(`Installing ${appPath}`);
    child_process.spawnSync('xcrun', ['simctl', 'install', 'booted', appPath], {stdio: 'inherit'});

    const bundleID = child_process.execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print:CFBundleIdentifier', path.join(appPath, 'Info.plist')],
      {encoding: 'utf8'}
    ).trim();

    console.log(`Launching ${bundleID}`);
    child_process.spawnSync('xcrun', ['simctl', 'launch', 'booted', bundleID], {stdio: 'inherit'});
  });
}

function runOnDevice(selectedDevice, scheme, xcodeProject, configuration, launchPackager, verbose, devteam) {
  return buildProject(xcodeProject, selectedDevice.udid, scheme, configuration, launchPackager, verbose, devteam)
  .then((appName) => {
    if (!appName) {
      appName = scheme;
    }
    const iosDeployInstallArgs = [
      '--bundle', getBuildPath(configuration, appName, true),
      '--id' , selectedDevice.udid,
      '--justlaunch'
    ];
    console.log(`installing and launching your app on ${selectedDevice.name}...`);
    const iosDeployOutput = child_process.spawnSync('ios-deploy', iosDeployInstallArgs, {encoding: 'utf8'});
    if (iosDeployOutput.error) {
      console.log('');
      console.log('** INSTALLATION FAILED **');
      console.log('Make sure you have ios-deploy installed globally.');
      console.log('(e.g "npm install -g ios-deploy")');
    } else {
      console.log('** INSTALLATION SUCCEEDED **');
    }
  });
}

function buildProject(xcodeProject, udid, scheme, configuration = 'Debug', launchPackager = false, verbose, devTeam) {
  return new Promise((resolve,reject) =>
  {
     var xcodebuildArgs = [
      xcodeProject.isWorkspace ? '-workspace' : '-project', xcodeProject.name,
      '-configuration', configuration,
      '-scheme', scheme,
      '-destination', `id=${udid}`,
      '-derivedDataPath', 'build',
    ];
    if(devTeam) {
      xcodebuildArgs.push("DEVELOPMENT_TEAM=" + devTeam)
    }
    console.log(`Building using "xcodebuild ${xcodebuildArgs.join(' ')}"`);
    let xcpretty;
    if (!verbose) {
      xcpretty = xcprettyAvailable() && child_process.spawn('xcpretty', [], { stdio: ['pipe', process.stdout, process.stderr] });
    }
    const buildProcess = child_process.spawn('xcodebuild', xcodebuildArgs, getProcessOptions(launchPackager));
    let buildOutput = '';
    buildProcess.stdout.on('data', function(data) {
      buildOutput += data.toString();
      if (xcpretty) {
        xcpretty.stdin.write(data);
      } else {
        console.log(data.toString());
      }
    });
    buildProcess.stderr.on('data', function(data) {
      console.error(data.toString());
    });
    buildProcess.on('close', function(code) {
      if (xcpretty) {
        xcpretty.stdin.end();
      }
      //FULL_PRODUCT_NAME is the actual file name of the app, which actually comes from the Product Name in the build config, which does not necessary match a scheme name,  example output line: export FULL_PRODUCT_NAME="Super App Dev.app"
      let productNameMatch = /export FULL_PRODUCT_NAME="?(.+).app"?$/m.exec(buildOutput);
      if (productNameMatch && productNameMatch.length && productNameMatch.length > 1) {
        return resolve(productNameMatch[1]);//0 is the full match, 1 is the app name
      }
      return buildProcess.error ? reject(buildProcess.error) : resolve();
    });
  });
}

function matchingDevice(devices, deviceName) {
  if (deviceName === true && devices.length === 1)
  {
    console.log(`Using first available device ${devices[0].name} due to lack of name supplied.`);
    return devices[0];
  }
  for (let i = devices.length - 1; i >= 0; i--) {
    if (devices[i].name === deviceName || formattedDeviceName(devices[i]) === deviceName) {
      return devices[i];
    }
  }
}

function matchingDeviceByUdid(devices, udid) {
  for (let i = devices.length - 1; i >= 0; i--) {
    if (devices[i].udid === udid) {
      return devices[i];
    }
  }
}

function formattedDeviceName(simulator) {
  return `${simulator.name} (${simulator.version})`;
}

function printFoundDevices(devices) {
  for (let i = devices.length - 1; i >= 0; i--) {
    console.log(devices[i].name + ' Udid: ' + devices[i].udid);
  }
}

function getProcessOptions(launchPackager) {
  if (launchPackager) {
    return {};
  }

  return {
    env: Object.assign({}, process.env, { RCT_NO_LAUNCH_PACKAGER: true }),
  };
}

module.exports = {
  name: 'runios',
  description: 'blah blah blah builds your app and starts it on iOS simulator',
  func: runIOS,
  examples: [
  {
    desc: 'Run on a different simulator, e.g. iPhone 5bibble',
    cmd: 'react-native run-ios --simulator "iPhone 5"',
  },
  {
    desc: 'Pass a non-standard location of iOS directory',
    cmd: 'react-native run-ios --project-path "./app/ios"',
  },
  {
    desc: "Run on a connected device, e.g. Max's iPhone",
    cmd: 'react-native run-ios --device "Max\'s iPhone"',
  },
  ],
  options: [{
    command: '--simulator [string]',
    description: 'Explicitly set simulator to use',
    default: 'iPhone 6',
  } , {
    command: '--configuration [string]',
    description: 'Explicitly set the scheme configuration to use',
  } , {
    command: '--scheme [string]',
    description: 'Explicitly set Xcode scheme to use',
  }, {
    command: '--project-path [string]',
    description: 'Path relative to project root where the Xcode project '
      + '(.xcodeproj) lives. The default is \'ios\'.',
    default: 'ios',
  }, {
    command: '--device [string]',
    description: 'Explicitly set device to use by name.  The value is not required if you have a single device connected.',
  }, {
    command: '--udid [string]',
    description: 'Explicitly set device to use by udid',
  }, {
    command: '--no-packager',
    description: 'Do not launch packager while building',
  }, {
    command: '--verbose',
    description: 'Do not use xcpretty even if installed',
  }, {
    command: '--development-team [string]',
    description: "Explicitly set development team. Uses saved development team ID if not specified"
  }],
};
