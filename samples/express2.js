const path = require('path')
const ServeDown = require('../lib/servedown')

ServeDown.start( // Factory static helper method
  {
    cacheDir: path.join(__dirname, '..', 'dist', 'working', 'cache'), // Cache dir
    repos: [{ // Git repos to get the markdown docs from
      name: 'servedown',
      url: 'https://github.com/openhoat/servedown'
    }]
  })
  .then(() => {
    console.log('ready')
  })
