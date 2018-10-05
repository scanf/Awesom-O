'use strict';

const {dialog, app, BrowserWindow, ipcMain, Notification} = require('electron')
var path = require('path')
const { fsCache } = require('./electron-caches.js')
const fs = require('fs')
var giveMeAJoke = require('give-me-a-joke');

let chatbot = require('./chatbot.js')
let mainWindow

let chatClient
let commandPrefix = '!'
let builtinCommands = {echo, help, commands, joke}
var greetedUsers = []

function useExampleCommands() {
  var commands = [
    { type: "string", name: "what",  description: "Print out the current project", value: "Twitch bot", enabled: true},
    { type: "string", name: "when", description: "Print stream schedule", value: "From 5PM to roughly 7PM (GMT+2)", enabled: true},
    { type: "string", name: "github", description: "Print GitHub profile URL", value: "https://github.com/scanf", enabled: true},
    { type: "string", name: "gitlab", description: "Print GitHub profile URL", value: "https://gitlab.com/scanf", enabled: true},
    { type: "string", name: "bashrc", description: "my bash profile", value: "https://github.com/scanf/dotfiles/tree/master/shell", enabled: true},
    { type: "string", name: "twitter", description: "Link to my Twitter", value: "https://twitter.com/ccscanf", enabled: true},
    { type: "file", name: "music", description: "Currently playing music", value: "/var/folders/2d/2xkdk5xd64z4s_l27tcyrwdc0000gp/T/com.alemayhu.-000/file-for-obs.txt", enabled: true },
    { type: "string", name: "donate", description: "Link to my donation page", value: "https://streamlabs.com/ccscanf", enabled: true},
    { type: "builtin", name: "echo", description: "Print out everything after echo", enabled: true},
    { type: "builtin", name: "commands", description: "List all of the supported commands", enabled: true},
    { type: "builtin", name: "help", description: "Show description for a command", enabled: true},
    { type: "builtin", name: "joke", description: "Get a random joke ;-)", enabled: true},
  ]
  console.log('commands='+commands)
  fsCache.save('commands', commands)
}

function createWindow () {
  mainWindow = new BrowserWindow({width: 1920, height: 1080,
    icon: path.join(__dirname, 'assets/icons/png/64x64.png')
  })

  mainWindow.loadFile('index.html')

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()

  mainWindow.on('closed', function () {
    mainWindow = null
  })

  configure()
}

app.on('ready', createWindow)

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow()
  }
})

function displayNotification(title, body) {
  const n = new Notification({ title: title, body: body, silent: false});
  n.on('show', () => console.log('showed'));
  n.on('click', () => console.info('clicked!!'));
  n.show();
}

function onMessageHandler (target, context, msg, self) {
  if (self) { return } // Ignore messages from the bot

  // This isn't a command since it has no prefix:
    if (msg.substr(0, 1) !== commandPrefix && context.username !== global.config.name.replace('#', '')) {
      console.log(`[${target} (${context['message-type']})] ${context.username}: ${msg}`)
      displayNotification('Message from @'+context.username, msg)
      return
    }

    // Split the message into individual words:
    const parse = msg.slice(1).split(' ')
    // The command name is the first (0th) one:
    const commandName = parse[0]
    // The rest (if any) are the parameters:
    const params = parse.splice(1)

    let cmd = global.commands.find(function(e){
      if (e.name == commandName) {
        return e
      }
    })

    if (!cmd) {
      console.log(`* Unknown command ${commandName} from ${context.username}`)
      return
    }

    if (cmd.enabled === false) {
      chatClient.say(target, '!'+commandName+' is disabled')
      return
    }

    // Handle the builtin commands
    if (commandName in builtinCommands) {
      const commandHandler = builtinCommands[commandName]
      if (commandHandler)
        commandHandler(target, context, params)
    }
    // Handle the user defined commands
    else {
      if (cmd && cmd.type == "string") {
        sendMessage(target, context, cmd.value)
      } else if (cmd && cmd.type == "file") {
        let msg = fs.readFileSync(cmd.value , 'utf-8')
        chatClient.say(target, msg)
      }
    }
    console.log(`* Executed ${commandName} command for ${context.username}`)
}

function onJoinHandler (channel, username, self) {
    console.log(`onJoinHandler(${channel}, ${username}, ${self})`)
    if (self || username == global.config.name.replace('#', '')) { return }
    let didGreetUser = greetedUsers.find(function(u) {
      if (u == username) { return u }
    })
    if (didGreetUser) { return }
    greetedUsers.push(username)
    let msg = 'Welcome @'+username+', see !commands for chat commands ;-)'
    chatClient.say(channel, msg)
}

function onHostedHandler (channel, username, viewers, autohost) {
  let msg = channel+' is hosted by '+username+' viewers='+viewers
  chatClient.say(channel, msg)
};

function onConnectedHandler (addr, port) {
  console.log(`* Connected to ${addr}:${port}`)
}

function onDisconnectedHandler (reason) {
  displayNotification('Awesom-O disconnected', reason)
  if (global.config.autoConnect) {
    console.log("Reconnecting attempt")
    chatClient.connect()
  }
}

// ---

function isValid(config) {
  return config && config.name && config.bot && config.oauth
}

function loadCacheFiles() {
  global.commands = fsCache.load().commands
  if (!global.commands || global.commands.length == 0) {
    useExampleCommands()
    global.commands = fsCache.load().commands
  }
  global.config = fsCache.secrets()["config"]
}

function configure() {
  loadCacheFiles()
  if (!isValid(config)) {
    mainWindow.loadFile('configuration.html')
  } else {
    setupClient()
  }
}

function setupClient() {
  chatClient = new chatbot({
      channel: global.config.name,
      username: global.config.bot,
      password: global.config.oauth
  });

  chatClient.on('message', onMessageHandler)
  chatClient.on('connected', onConnectedHandler)
  chatClient.on('disconnected', onDisconnectedHandler)
  chatClient.on('join', onJoinHandler)
  chatClient.on('hosted', onHostedHandler)

  if (global.config.autoconnect) {
    chatClient.connect()
  }
}

// Handle renderer messages

ipcMain.on('connect-bot', (event, arg) => {
    chatClient.connect();
})

ipcMain.on('disconnect-bot', (event, arg) => {
  chatClient.disconnect();
})

ipcMain.on('new-command', (event, cmd) => {
  console.log('new-command')
  let commands = global.commands
  let existingCmd = commands.find(function(e) {
    console.log(e.name+' === '+cmd.name)
    if (e.name == cmd.name) {
      return e
    }
  })
  console.log('existingCmd == '+existingCmd)
  if (existingCmd) {
    console.log('existingCmd')
    console.log(existingCmd)
    if (existingCmd.type != "builtin") {
      existingCmd.name = cmd.name
      existingCmd.type = cmd.type
      existingCmd.description = cmd.description
      existingCmd.value = cmd.value
    }
    existingCmd.enabled = cmd.enabled
  } else {
    console.log('Added cmd '+cmd)
    commands.push(cmd)
  }
  global.commands = commands
  fsCache.save('commands', commands)
  global.selectedCommand = null
  mainWindow.loadFile('index.html')
})

ipcMain.on('selected-command', (event, cmd) => {
    global.selectedCommand = cmd
    mainWindow.loadFile('new-command.html')
})

ipcMain.on('new-configuration', (event, config) => {
  fsCache.saveSecret({"config": config})
  loadCacheFiles()
  setupClient()
  mainWindow.loadFile('index.html')
})


ipcMain.on('export-command', (event, arg) => {
    let defaultPath = '~/Downloads/data.json'
    dialog.showSaveDialog( {
        title: "Save commands",
        defaultPath: defaultPath,
        filters: [
            { name: 'data', extensions: ['json'] },
        ],
    }, function (filePaths, bookmarks) {
      fs.writeFileSync(filePaths, JSON.stringify({"commands": global.commands}, null, 2))
    });
})

ipcMain.on('import-command', (event, arg) => {
    dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { extensions: ['json']},
      ]
    }, function (filePaths, bookmarks) {
      if (!filePaths) {
        return
      }
      let path = filePaths.toString()
      global.commands = fsCache.readAll(path).commands
      fsCache.saveAll({"commands": global.commands})
      // TODO: avoid reloading whole page
      mainWindow.loadFile('index.html')
    })
})


// Commands

// Function called when the "echo" command is issued:
function echo (target, context, params) {
  console.log('echo(...)')
  // If there's something to echo:
  if (params.length) {
    // Join the params into a string:
    const msg = params.join(' ')
    // Send it back to the correct place:
    sendMessage(target, context, msg)
  } else { // Nothing to echo
    console.log(`* Nothing to echo`)
  }
}

// Function called when the "joke" command is issued:
function joke (target, context, params) {
  // TODO: pick one at random

  // To get a random dad joke
  giveMeAJoke.getRandomDadJoke (function(joke) {
      sendMessage(target, context, joke)
  });

  // To get a random Chuck Norris joke
  // giveMeAJoke.getRandomCNJoke (function(joke) {
  //     //=> console.log(joke);
  // });
  //
  // // To get a customized joke
  // var fn = "Jackie";
  // var ln = "Chan";
  // giveMeAJoke.getCustomJoke (fn, ln, function(joke) {
  //     //=> console.log(joke);
  // });

}

// Function called when the "commands" command is issued:
function commands (target, context, params) {
  // TODO: refactor below
  var msg = ""
  // Get user defined commands
  let c = global.commands
  for (var k in c) {
    let cmd = c[k]
    if (cmd.enabled) {
      msg += '!'+cmd.name+' '
    }
  }
  sendMessage(target, context, msg)
}

// Function called when the "help" command is issued:
function help (target, context, params) {
  if (params.length) {
    const msg = params.join(' ')
    let c = global.commands
    for (var k in c) {
      let cmd = c[k]
      if (cmd.name != msg) {
        continue;
      }
      sendMessage(target, context, '!'+cmd.name+' - '+cmd.description)
      break;
    }
  } else {
    sendMessage(target, context, 'USAGE: '+'!help cmd (without !)')
  }
}

// Helper function to send the correct type of message:
function sendMessage (target, context, message) {
  if (context['message-type'] === 'whisper') {
    chatClient.whisper(target, message)
  } else {
    chatClient.say(target, message)
  }
}
