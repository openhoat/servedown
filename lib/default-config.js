'use strict';

const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const hljs = require('highlight.js');
const logger = require('hw-logger');
const log = logger.log;
const helper = require('./helper');
const homeDir = helper.homeDir;
const baseDir = helper.baseDir;
const pkg = helper.pkg;

const config = {
  // Source directory where markdown docs resides
  srcDir: path.join(homeDir, `.${pkg.name}`, 'src'),
  // Cache directory
  cacheDir: path.join(homeDir, `.${pkg.name}`, 'cache'),
  // Directory to exclude from scan
  excludeDir: '(\.git|\.gitignore|\.idea|node_modules)$',
  // Enable or disable git operations
  enableGit: true,
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
  indexPattern: /(readme|home|index)/i,
  // Default provided themes (feel free to add yours)
  themes: fs.readdirSync(path.join(baseDir, 'themes')).reduce((acc, dir) => {
    acc[dir] = path.join(baseDir, 'themes', dir);
    return acc;
  }, {}),
  // Default theme name (ovverride in browser with ?theme=)
  defaultTheme: process.env['THEME'] || 'mydocs',
  // Templates used to render
  templates: {
    // Template file name to render html
    doc: 'doc.html',
    // Template file name to render root page
    index: 'index.html',
    // Template file name to render search form
    searchform: 'searchform.html',
    // Template file name to render search result
    search: 'search.html'
  },
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
    smartypants: false,
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
  // Preprocessing rules (used before markdown to html conversion)
  preprocessingRules: [
    { // {{{{{{ websequence diagram }}}}}}
      pattern: /[{]{6}[\s]*([\w-]*)[\r\n]+((((?![}]{6}).)|[\r\n])*)[\r\n\s]+[}]{6}/gm,
      replace(raw, style, content) {
        content = content
          .split(/[\n\r]/)
          .filter(line => line !== '')
          .map(line => line.replace(/^[\s]*(.*)$/, '\t$1'))
          .join('\n');
        return [
          `<div class="wsd" wsd_style="${style}"><pre>`,
          '',
          content,
          '',
          '</pre></div><script src="http://www.websequencediagrams.com/service.js"></script>'
        ].join('\n');
      }
    }, { // [[ include: path1/.../file.md ]]
      pattern: /[\[]{2}[\s]*include\:[\s]*([\S]+)[\s]*[\]]{2}/g,
      replace(raw, includePath) {
        log.warn('includePath :', includePath);
        log.warn('this.processingFile :', this.processingFile);
        logger.enabledLevels.trace && log.trace(
          `processing include directive "${includePath}" in ${this.processingFile}`
        );
        const srcDir = this.getConfig('srcDir');
        if (includePath.indexOf('/') !== 0) {
          includePath = path.resolve(path.dirname(path.join(srcDir, this.processingFile)), includePath);
        } else {
          includePath = path.join(srcDir, includePath);
        }
        log.warn('includePath :', includePath);
        let html;
        const deasync = require('deasync');
        this.processDoc(path.relative(srcDir, includePath))
          .then(meta => {
            html = meta.content.htmlContent;
          })
          .catch(err => {
            const msg = err.toString();
            if (logger.enabledLevels.debug) {
              log.debug(err);
            } else {
              logger.enabledLevels.warn && log.warn(msg);
            }
            html = `<span class="error">${msg}</span>`;
          });
        deasync.loopWhile(() => !html);
        return html;
      }
    }, { // [[ LinkTitle ]]
      pattern: /[\[]{2}[\s]*([^\]]*)[\s]*[\]]{2}/g,
      replace(raw, content) {
        const link = helper.toId(_.compact(content.toLowerCase().split(/[\s]/)).join('-'));
        return `[${content}](${link})`;
      }
    }
  ],
  // Rendering rules (see https://github.com/chjj/marked for more information)
  renderingRules: {
    heading(text, level, raw) {
      text = text.replace(/(<([^>]+)>)/ig, '');
      const id = helper.toId(raw);
      if (level === 2) {
        this.toc.push({id, title: text});
      }
      return `<h${level} id="${id}">${raw}</h${level}>\n`;
    }
  },
  // Default template contents
  templateContents: {
    doc: `<!doctype html>
<html lang="en">
<head><title><%- title %></title><meta charset="utf-8"></head>
<body><%= body %></body>
</html>`,
    index: `<h1>Welcome :-)</h1>
<p>This is the root page of your docs, please select a doc to browse :</p>
<% folders.forEach(folder => { %>
<h3><a title="<%= folder.title %>" href="<%= folder.name %>/"><%= folder.title %></a></h3>
<% }); %>`,
    search: `<h3>Search result matching : <q><%= q %></q></h3>
<% if (docs.length) { %>
<ul>
  <% docs.forEach(doc => { %>
  <li><a href="<%- doc %>?highlight=<%- encodeURIComponent(q) %>"><%= doc %></a></li>
  <% });%>
</ul>
<% } else { %>
<p><strong>Ooops… it seems that no content matches your query :-(</strong></p>
<% } %>`,
    searchform: `<div class="searchform-container">
  <h2>Search content</h2>
  <form id="search-form" method="GET" action="/">
      <input type="text" name="q" class="form-control input-lg">
      <input type="submit" value="Search">
  </form>
</div>`
  },
  // Cache configuration
  cache: {
    ttl: 200 * 365 * 24 * 60 * 60
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
