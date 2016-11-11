## Servedown

Serve your markdown documentations

## Installation

```
$ npm i servedown -g
```

## Usage

### Command line

### Module

#### Express app

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

Enjoy!
