[![NPM version](https://badge.fury.io/js/servedown.svg)](http://badge.fury.io/js/servedown)

# Servedown

Serve your markdown documentations

## Why?

- Needed to have a simple solution to render markdown files in many git projects
- Did not get fully satisfied with [gollum](https://github.com/gollum/gollum) or [smeagol](https://github.com/rubyworks/smeagol) (though there are very nice)
- Render docs for read-only usage
- Ability to easily customize styles and templates 

## Command line

The simplest way to use servedown is the command line.

All you have to do is :

1. set your servedown configuration file (.servedown.yml) into your home directory
2. run the servedown command

### Installation

```
$ npm i servedown -g
```

### Usage

Set your custom configuration in ~/.servedown.yml :

Default configuration :

```yaml
workingDir: "/home/user/.servedown"                     # Working directory where git repos are checked out
excludeDir: "(.git|.gitignore|.idea|node_modules)$"     # Directory to exclude from scan
repos:                                                  # Git repos containing markdown files to serve
  - name: servedown
    url: https://github.com/openhoat/servedown          # URL of repo (used for source link, and when ssh is not used)
    # ssh: git@mygitlabserver/myproject                 # Example of gitlab ssh URL
    # filePattern: /blob/master/{{file}}                # URL pattern to directly link the file source
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
```

Starts the servedown doc server :

```
$ servedown
```

By default servedown will checkout all git repos into ~/.servedown directory.

## Module

If you prefer to embed servedown features into an existing express app, then use the provided middleware.

### Installation

```
$ cd yournodeproject
$ npm i servedown --save
```

### Usage

```
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

- Theme support : use one of the two themes provided or use your owns, and hot switch the current theme with ?theme=
- TOC support : generated from level 2 headers of the content 
- Git source link
- Hot update : add ?update to your browser address and it will reload (included git update)

Enjoy!
