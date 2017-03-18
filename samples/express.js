const path = require('path')
const express = require('express')
const ServeDown = require('../lib/servedown')
const app = express()

const servedown = new ServeDown() // Create a servedown instance

servedown.init({ // Initialize with custom config
  cacheDir: path.join(__dirname, '..', 'dist', 'working', 'cache'), // Cache dir
  repos: [{ // Git repos to get the markdown docs from
    name: 'servedown',
    url: 'https://github.com/openhoat/servedown'
  }]
})
app.use(servedown.buildExpressRouter()) // Use provided express middleware
app.listen(3000, () => {
  servedown.process(() => {  // Prepare html rendering
    console.log('ready')
  })
})
