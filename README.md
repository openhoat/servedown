[![NPM version](https://badge.fury.io/js/servedown.svg)](http://badge.fury.io/js/servedown)
[![Build Status](https://travis-ci.org/openhoat/servedown.png?branch=master)](https://travis-ci.org/openhoat/servedown)
[![Coverage Status](https://coveralls.io/repos/openhoat/servedown/badge.svg)](https://coveralls.io/r/openhoat/servedown)
[![npm](https://img.shields.io/npm/l/express.svg?style=flat-square)]()

# Servedown

Serve your markdown documentations

## Why?

- Needed a simple solution to render markdown files in many git projects
- Did not get fully satisfied with [gollum](https://github.com/gollum/gollum) or [smeagol](https://github.com/rubyworks/smeagol)
- Render docs for read-only usage
- Ability to easily customize styles and templates 

## Getting started

With a sample configuration, let's serve this project documentation :

- Configuration ~/.servedown.yml :

    ```yml
    repos:
      - name: servedown
        ssh: git@github.com:openhoat/servedown.git
        url: https://github.com/openhoat/servedown
        filePattern: /blob/master/{{file}}
    ```

- Start the server :

    ```shell
    $ servedown
    INFO  - servedown:181 - 131ms - cloning repo "servedown"...
    INFO  - servedown:409 - 4.2s - servedown is listening to 0.0.0.0:3000
    ```

    Now your server is ready...

- Browse :

    ```shell
    $ xdg-open http://localhost:3000
    ```

- Result :

    <img title="Welcome page" src="samples/screenshot1.png" width="450">

    The welcome page is generated from a default template string (or your own index.html)

- Click on "Servedown" doc project :

    <img title="Servedown README" src="samples/screenshot2.png" width="450">

    Now you see your markdown files rendered with styles :-)
 
## Command line

The simplest way to use servedown is the command line.

All you have to do is :

1. setup your servedown configuration file (.servedown.yml) into your home directory
2. run the servedown command

### Installation

```shell
$ npm i servedown -g
```

### Usage

Set your custom configuration in ~/.servedown.yml :

Default configuration :

```yaml
workingDir: "/home/user/.servedown"                     # Working directory where git repos are checked out
excludeDir: "(.git|.gitignore|.idea|node_modules)$"     # Directory to exclude from scan
enableGit: true                                         # Enable or disable git operations
repos:                                                  # Git repos containing markdown files to serve
  - name: servedown
    url: https://github.com/openhoat/servedown          # URL of repo (used for source link, and when ssh is not used)
    ssh: git@mygitlabserver/myproject                   # Example of gitlab ssh URL
    filePattern: /blob/master/{{file}}                  # URL pattern to directly link the file source
#    branch: master                                     # Custom branch name (defaults to master)
repoInclude:                                            # If set, only fetch the specified directories (faster git clone)
  - assets/
markdownExt:                                            # Markdown file extensions to match while scanning (no reason to change)
  - md
  - markdown
indexPattern: "(readme|home)"                           # File names to consider as index for browsing
themes:                                                 # Default provided themes (feel free to add yours)
  mydocs: "/project/servedown/themes/mydocs"
  simple: "/project/servedown/themes/simple"
defaultTheme: bnum                                      # Default theme name (ovverride in browser with ?theme=)
template: template.html                                 # Template file name to render html
indexTemplate: index.html                               # Template file name to render root page
defaultTitle: Home                                      # Default title (for example, used in root page)
updateQuery: true                                       # True, to enable hot update support (?update in browser) 
htmlRender:                                             # Configuration to use to convert md to html
  html: true                                            # For full usage information please see https://github.com/chjj/marked
  xhtmlOut: false
  breaks: false
  langPrefix: lang-
  linkify: false
  typographer: false
  quotes: "“”‘’"
server:                                                 # Server configuration : used only from command line
  host: "0.0.0.0"                                       # Optionnal server host to listen
  port: 3000                                            # Server port, overrided by SERVEDOWN_PORT environment variable
  # socket:                                             # Optionnal server *nix socket, overrided by SERVEDOWN_SOCKET environment variable (is set, port and host are ignored)
```

Starts the servedown doc server :

```shell
$ servedown
```

If repos are specified in configuraton servedown will checkout them into the working directory (~/.servedown), then it will compute recursively the working dir to render the doc site.

## Module

If you prefer to embed servedown features into an existing express app, then use the provided middleware.

### Installation

```shell
$ cd yournodeproject
$ npm i servedown --save
```

### Usage

```javascript
const path = require('path');
const express = require('express');
const ServeDown = require('../lib/servedown');
const app = express();

const servedown = new ServeDown(); // Create a servedown instance

servedown.init({ // Initialize with custom config
  workingDir: path.join(__dirname, '..', '.working'), // Temp dir for working copies
  repos: [{ // Git repos to get the markdown docs from
    name: 'servedown',
    url: 'https://github.com/openhoat/servedown'
  }]
});
servedown.compute() // Prepare html rendering
  .then(() => {
    app.use(servedown.buildExpressRouter()); // Use provided express middleware
    app.listen(3000, () => {
      console.log('ready');
    });
  });
```

## Features

### Theme support
 
Use one of the two themes provided or use your owns, and hot switch the current theme with **?theme=**

### TOC support
 
Table of contents is dynamically generated from the level 2 headers of markdown contents.

### Web sequence diagrams support
 
Embed your [websequence diagrams](https://www.websequencediagrams.com/) in md content with **{{{{{{** **}}}}}}** tags.

Example :

```
{{{{{{ modern-blue

title Authentication Sequence

Alice->Bob: Authentication Request
note right of Bob: Bob thinks about it
Bob->Alice: Authentication Response

}}}}}}
```

### Git source link

Optionnaly show the source link of the current document to make documentation changes easy.

### Hot update

Add **?update** to your browser address and it will reload, included git update.

Enjoy!
