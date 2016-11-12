'use strict';

const path = require('path');
const fs = require('fs');
const hljs = require('highlight.js');
const pkg = require('../package.json');
const homeDir = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
const baseDir = path.join(__dirname, '..');

const config = {
  workingDir: path.join(homeDir, `.${pkg.name}`),
  excludeDir: '(\.git|\.gitignore|\.idea|node_modules)$',
  repos: [{
    name: `${pkg.name}`,
    url: `https://github.com/openhoat/${pkg.name}`
  }],
  repoInclude: ['assets/'],
  markdownExt: ['md', 'markdown'],
  indexPattern: /(readme|home)/i,
  themes: fs.readdirSync(path.join(baseDir, 'themes')).reduce((acc, dir) => {
    acc[dir] = path.join(baseDir, 'themes', dir);
    return acc;
  }, {}),
  defaultTheme: process.env['THEME'] || 'mydocs',
  template: 'template.html',
  indexTemplate: 'index.html',
  defaultTitle: 'Home',
  updateQuery: true,
  htmlRender: {
    html: true,
    xhtmlOut: false,
    breaks: false,
    langPrefix: 'lang-',
    linkify: false,
    typographer: false,
    quotes: '“”‘’',
    highlight: (str, lang) => {
      try {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(lang, str).value;
        }
        return hljs.highlightAuto(str).value;
      } catch (err) {
        return str;
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: process.env['SERVEDOWN_PORT'] || 3000,
    socket: process.env['SERVEDOWN_SOCKET']
  }
};

exports = module.exports = config;
