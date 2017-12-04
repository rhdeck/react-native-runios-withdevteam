const child_process = require('child_process');
const fs = require('fs');
const cpp = require('child-process-promise');
const inquirer = require("inquirer")

var homeinfo = {};
const homefile = process.env.HOME + "/.rninfo";
if(fs.existsSync(homefile)) {
    homeinfo = JSON.parse(fs.readFileSync(homefile))
} else {
    homeinfo = {};
}
function getFromDevTeams() {
    return new Promise((resolve, reject) => {
        if(!homeinfo.devteams) {
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
            writeDefaultTeam(devteam);
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
function getDevTeam(){
    return homeinfo.devteam;
}
function writeDefaultTeam(devteam) {
    if(homeinfo.devteam != devteam) {
        console.log("Saving development team to cache for future use:", devteam);
        console.log("Next time, running --development-team without argument will use this saved value.")
        homeinfo.devteam = devteam;
        fs.writeFileSync(homefile, JSON.stringify(homeinfo));
    } else {
        console.log("This is already your default development team:", devteam)
    }

}
module.exports = {
    "writeDefaultTeam": writeDefaultTeam,
    "getDevTeam": getDevTeam,
    "getFromDevTeams": getFromDevTeams
}