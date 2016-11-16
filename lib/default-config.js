'use strict';

const path = require('path');
const fs = require('fs');
const hljs = require('highlight.js');
const pkg = require('../package.json');
const homeDir = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
const baseDir = path.join(__dirname, '..');

const config = {
  // Working directory where git repos are checked out
  workingDir: path.join(homeDir, `.${pkg.name}`),
  // Directory to exclude from scan
  excludeDir: '(\.git|\.gitignore|\.idea|node_modules)$',
  // Enable or disable git operations
  enableGit: false,
  // Git repos containing markdown files to serve
  repos: [{
    // Name of the subdir in the working dir
    name: `${pkg.name}`,
    // URL of repo (used for source link, and when ssh is not used)
    url: `https://github.com/openhoat/${pkg.name}`
    // Example of gitlab ssh URL
    //ssh: git@mygitlabserver/myproject
    // URL pattern to directly link the file source
    //filePattern: /blob/master/{{file}}
    // Custom branch name (defaults to master)
    //branch: master
  }],
  // If set, only fetch the specified directories (faster git clone)
  repoInclude: ['assets/'],
  // Markdown file extensions to match while scanning (no reason to change)
  markdownExt: ['md', 'markdown'],
  // File names to consider as index for browsing
  indexPattern: /(readme|home)/i,
  // Default provided themes (feel free to add yours)
  themes: fs.readdirSync(path.join(baseDir, 'themes')).reduce((acc, dir) => {
    acc[dir] = path.join(baseDir, 'themes', dir);
    return acc;
  }, {}),
  // Default theme name (ovverride in browser with ?theme=)
  defaultTheme: process.env['THEME'] || 'mydocs',
  // Template file name to render html
  template: 'template.html',
  // Template file name to render root page
  indexTemplate: 'index.html',
  // Template file name to render search result
  searchTemplate: 'search.html',
  // Default title (for example, used in root page)
  defaultTitle: 'Home',
  // True, to enable hot update support (?update in browser)
  updateQuery: true,
  // Configuration to use to convert md to html
  // For full usage information please see https://github.com/chjj/marked
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
  // Server configuration : used only from command line
  server: {
    // Optionnal server host to listen
    host: '0.0.0.0',
    // Server port, overrided by SERVEDOWN_PORT environment variable
    port: process.env['SERVEDOWN_PORT'] || 3000,
    // Optionnal server *nix socket
    // overrided by SERVEDOWN_SOCKET environment variable (if set, port and host are ignored)
    socket: process.env['SERVEDOWN_SOCKET']
  }
};

exports = module.exports = config;
