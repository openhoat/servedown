'use strict';

const Promise = require('bluebird');
const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const template = require('lodash.template');
const childProcess = require('child_process');
//const YAML = require('yamljs');
//const express = require('express');
//const marked = require('marked');
const url = require('url');
//const mkdirp = require('mkdirp');
//const rimraf = require('rimraf');
const logger = require('hw-logger');
const log = logger.log;
const pkg = require('../package.json');
const homeDir = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
const baseDir = path.join(__dirname, '..');
const accents = [
  {from: /[\300-\306]/g, to: 'A'},
  {from: /[\340-\346]/g, to: 'a'},
  {from: /[\310-\313]/g, to: 'E'},
  {from: /[\350-\353]/g, to: 'e'},
  {from: /[\314-\317]/g, to: 'I'},
  {from: /[\354-\357]/g, to: 'i'},
  {from: /[\322-\330]/g, to: 'O'},
  {from: /[\362-\370]/g, to: 'o'},
  {from: /[\331-\334]/g, to: 'U'},
  {from: /[\371-\374]/g, to: 'u'},
  {from: /[\321]/g, to: 'N'},
  {from: /[\361]/g, to: 'n'},
  {from: /[\307]/g, to: 'C'},
  {from: /[\347]/g, to: 'c'}
];

Promise.promisifyAll(fs);

const helper = {
  pkg,
  homeDir,
  baseDir,
  fs,
  updateGitRepo: ({contentDir, repos, repoInclude, markdownExt}, cb) => {
    logger.enabledLevels.trace && log.trace('checking git repos : ', repos);
    const executeCmd = (command, ...opts) => {
      logger.enabledLevels.trace && log.trace(`execute comand "${command}"`);
      return Promise.promisify(childProcess.exec, {multiArgs: true})(command, ...opts);
    };
    repos = Array.isArray(repos) ? repos : [repos];
    return Promise.each(repos, repo => {
      const repoDir = path.join(contentDir, repo.name);
      const result = {stdout: '', stderr: ''};
      const handleStd = (stdout, stderr) => {
        if (stdout) {
          logger.enabledLevels.debug && log.debug(stdout);
          result.stdout += stdout;
        }
        if (stderr) {
          logger.enabledLevels.warn && log.warn(stderr);
          result.stderr += stderr;
        }
      };
      return fs.statAsync(repoDir)
        .then(stat => {
          if (stat.isDirectory()) {
            logger.enabledLevels.info && log.info(`updating repo "${repo.name}"...`);
            return executeCmd('git pull --quiet', {cwd: repoDir});
          }
          throw new Error(`${repoDir} exists and is not a directory!`);
        })
        .catch(err => {
          if (err.code !== 'ENOENT') {
            throw err;
          }
          const cloneUrl = repo.ssh || repo.url;
          logger.enabledLevels.info && log.info(`cloning repo "${repo.name}"...`);
          const includeGit = repoInclude && markdownExt.map(ext => `**/*.${ext}`)
              .concat(repoInclude)
              .join('\n');
          if (includeGit) {
            return executeCmd(`git init ${repo.name}`, {cwd: contentDir})
              .then(() => {
                const gitOpts = {cwd: path.join(contentDir, repo.name)};
                return executeCmd('git config core.sparseCheckout true', gitOpts)
                  .then(() => executeCmd(`echo "${includeGit}" > .git/info/sparse-checkout`, gitOpts))
                  .then(() => executeCmd(`git remote add -f origin ${cloneUrl}`, gitOpts))
                  .then(() => executeCmd(`git checkout ${repo.branch || 'master'} --quiet`, gitOpts));
              });
          }
          return executeCmd(`git clone --quiet ${cloneUrl} ${repo.name}`, {cwd: contentDir});
        })
        .spread(handleStd)
        .return(result)
        .asCallback(cb);
    });
  },
  scanMdFiles: ({baseDir, dir, filterDir, includeDir, excludeDir, filter, include, exclude}, cb) => {
    dir = dir ? path.join(baseDir, dir) : baseDir;
    logger.enabledLevels.debug && log.debug(`scanning markdown files from : ${dir}`);
    const relDir = path.relative(baseDir, dir);
    let p = fs.readdirAsync(dir);
    if (typeof filterDir === 'function') {
      p = p.filter(filterDir);
    } else {
      if (includeDir) {
        includeDir = new RegExp(includeDir);
        p = p.filter(file => includeDir.test(file));
      }
      if (excludeDir) {
        excludeDir = new RegExp(excludeDir);
        p = p.filter(file => !excludeDir.test(file));
      }
    }
    return p.reduce((found, file) => fs.statAsync(path.join(dir, file))
      .then(stats => {
        if (stats.isDirectory()) {
          return helper
            .scanMdFiles({
              baseDir, filterDir, includeDir, excludeDir, filter, include, exclude,
              dir: path.join(relDir, file)
            })
            .then(childs => found.concat(childs || []));
        }
        if (typeof filter === 'function') {
          if (!filter(file)) {
            return found;
          }
        } else {
          if (include) {
            if (!include.test(file)) {
              return found;
            }
          }
          if (exclude) {
            if (exclude.test(file)) {
              return found;
            }
          }
        }
        file = path.join(relDir, file);
        logger.enabledLevels.trace && log.trace(`found file : ${file}`);
        return found.concat(file);
      }), [])
      .asCallback(cb);
  },
  findRepo: (repoName, repos) => repoName && _.find(repos, {name: repoName}),
  withoutExt: file => file.slice(0, -path.extname(file).length),
  getRepoName: file => _.first(file.split('/')),
  toId: text => accents
    .reduce((text, accent) => text.replace(accent.from, accent.to), text)
    .replace(/['"]/, ' ')
    .toLowerCase()
    .replace(/[öäüÖÄÜ]/g, match => accents[match])
    .replace(/\W/, ' ').split(/\s/).join('-'),
  getTemplate({res, name, defaultContent}) {
    let tpl = _.get(this.locals, ['compiledTemplates', name, res.locals.theme]);
    if (!tpl) {
      let templateContent;
      let templateFile = this.getConfig(['templates', name]);
      if (templateFile) {
        const theme = this.getConfig('themes')[res.locals.theme];
        templateFile = path.join(theme, templateFile);
        try {
          templateContent = fs.readFileSync(templateFile, 'utf8');
        } catch (err) {
          if (err.code !== 'ENOENT') {
            throw err;
          }
        }
      }
      templateContent = templateContent || defaultContent;
      tpl = template(templateContent);
      _.set(this.locals, ['compiledTemplates', name, res.locals.theme], tpl);
    }
    return tpl;
  },
  middlewares: {
    context(req, res, next) {
      const context = _.first(_.compact(req.path.split('/')));
      if (Array.isArray(this.locals.contexts) && this.locals.contexts.includes(context)) {
        res.locals.context = context;
      }
      next();
    },
    update(req, res, next) {
      if (req.query.update === '' || req.query.update === 'true') {
        this.init(this.config);
        return this.process({context: res.locals.context})
          .then(() => {
            const reqUrl = url.parse(req.url, true);
            const redirectUrl = _.omit(reqUrl, ['search', 'query', 'path', 'href']);
            redirectUrl.query = _.omit(reqUrl.query, ['update']);
            res.redirect(url.format(redirectUrl));
          });
      }
      next();
    },
    theme(req, res, next) {
      res.locals.theme = req.query.theme || this.getConfig('defaultTheme');
      res.locals.compiledTemplate = helper.getTemplate.call(this, {
        res,
        name: 'doc'
      });
      next();
    },
    assets(req, res) {
      res.sendFile(req.params[0], {root: this.getConfig('themes')[res.locals.theme]});
    },
    searchForm(req, res) {
      res.locals.searchFormCompiledTemplate = helper.getTemplate.call(this, {
        res,
        name: 'searchform',
        defaultContent: `<div class="container">
	<div class="row">
    <div class="col-md-6">
      <h2>Search content</h2>
      <form id="search-form" method="GET" action="/">
        <div class="input-group col-md-12">
          <input type="text" name="q" class="form-control input-lg">
          <span class="input-group-btn">
            <button class="btn btn-info btn-lg" type="submit">
              <i class="glyphicon glyphicon-search"></i>
            </button>
          </span>
        </div>
      </form>
    </div>
	</div>
</div>`
      });
      const body = res.locals.searchFormCompiledTemplate();
      const html = res.locals.compiledTemplate({
        body,
        title: 'Search',
        pkg
      });
      res.status(200).send(html);
    },
    search(req, res, next) {
      if (!req.query.q) {
        return next();
      }
      const re = new RegExp(`((${req.query.q})(?![^<]*>|[^<>]*</))`, 'gmi');
      return Promise
        .reduce(Object.keys(this.locals.docs || {}), (matches, docName) => this.getDocMeta(docName).then(meta => {
          const mdContent = _.get(meta, 'content.mdContent');
          const match = re.exec(mdContent);
          if (match) {
            matches.push({match, meta});
          }
          return matches;
        }), [])
        .then(result => {
          const docs = result.map(item => this.buildDocUri(item.meta.mdFile));
          res.locals.searchCompiledTemplate = helper.getTemplate.call(this, {
            res,
            name: 'search',
            defaultContent: [
              '<h3>Search result matching : <q>${q}</q></h3>',
              '<% if (docs.length) { %>',
              '<ul>',
              '<% docs.forEach(doc => { %>',
              '<li><a href="<%- doc %>?highlight=<%- encodeURIComponent(q) %>">${doc}</a></li>',
              '<% });%>',
              '</ul>',
              '<% } else { %>',
              '<p><strong>Ooops… it seems that no content matches your query :-(</strong></p>',
              '<% } %>'
            ].join('\n')
          });
          const body = res.locals.searchCompiledTemplate({q: req.query.q, docs});
          const html = res.locals.compiledTemplate({
            body,
            title: this.getConfig('defaultTitle'),
            pkg
          });
          res.status(200).send(html);
        });
    },
    home(req, res) {
      res.locals.indexCompiledTemplate = helper.getTemplate.call(this, {
        res,
        name: 'index',
        defaultContent: [
          '<h1>Welcome :-)</h1>',
          '<p>This is the root page of your docs, please select a doc to browse :</p>',
          '<% folders.forEach(folder => { %>',
          '<h3><a title="<%= folder.title %>" href="<%= folder.name %>/"><%= folder.title %></a></h3>',
          '<% }); %>'
        ].join('\n')
      });
      const folders = (this.locals.contexts || [])
        .map(item => {
          const name = item.split('/').join('');
          const title = (s => s.charAt(0).toUpperCase() + s.slice(1))(name.replace(/[\W]/g, ' '));
          return {name, title};
        });
      const body = res.locals.indexCompiledTemplate({folders});
      const html = res.locals.compiledTemplate({
        body,
        title: this.getConfig('defaultTitle'),
        pkg
      });
      res.status(200).send(html);
    },
    doc(req, res, next) {
      const docData = _.get(this.locals, ['docs', req.path]);
      if (!docData) {
        if (_.get(this.locals, ['docs', req.path + '/'])) {
          res.redirect(req.path + '/');
          return;
        }
        res.sendFile(req.path, {root: this.getConfig('srcDir')}, err => {
          if (err && err.code === 'ENOENT') {
            return next();
          }
          next(err);
        });
        return;
      }
      return fs.readFileAsync(docData, 'utf8')
        .then(meta => {
          meta = JSON.parse(meta);
          let body = meta.content.htmlContent;
          if (req.query.highlight) {
            log.warn(`req.query.highlight : <${req.query.highlight}>`);
            try {
              const re = new RegExp(`(${req.query.highlight}(?!([^<]+)?>))`, 'gi');
              body = body.replace(re, '<span class="highlight">$1</span>');
            } catch (err) {
              logger.enabledLevels.warn && log.warn(err);
            }
          }
          const html = res.locals.compiledTemplate({
            toc: meta.content.toc,
            body,
            title: _.first(_.compact(req.path.split('/'))),
            repo: meta.repo,
            pkg
          });
          res.status(200).send(html);
        });
    },
    notFound(req, res) {
      const html = res.locals.compiledTemplate({
        body: '<h3>Ooops… resource not found</h3>',
        title: this.getConfig('defaultTitle'),
        pkg
      });
      res.status(200).send(html);
    },
    error(err, req, res, next) {
      if (res.headersSent) {
        return next(err);
      }
      log.error(err);
      const html = res.locals.compiledTemplate({
        body: `<h3>Ooops… an error occurred</h3><p>${err.toString()}</p>`,
        title: this.getConfig('defaultTitle'),
        pkg
      });
      res.status(500).send(html);
    }
  }
};

exports = module.exports = helper;
