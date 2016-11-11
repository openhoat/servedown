'use strict';

const Promise = require('bluebird');
const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const template = require('lodash.template');
const childProcess = require('child_process');
const YAML = require('yamljs');
const express = require('express');
const marked = require('marked');
const url = require('url');
const mkdirp = require('mkdirp');
const logger = require('hw-logger');
const log = logger.log;
const defaultConfig = require('./default-config');
const pkg = require('../package.json');

Promise.promisifyAll(fs);

class ServeDown {

  constructor(config) {
    this.config = config;
    this.locals = {};
    logger.enabledLevels.trace && log.trace(`${pkg.name} instance created`);
  }

  init(config) {
    logger.enabledLevels.debug && log.debug(`initializing ${pkg.name} instance`);
    this.config = config || this.config;
    this.locals.config = _.merge({}, defaultConfig, typeof this.config === 'string'
      ? YAML.parse(fs.readFileSync(this.config, 'utf8'))
      : this.config);
    logger.enabledLevels.debug && log.debug(`${pkg.name} instance initialized with : ${this.config}`);
    logger.enabledLevels.debug && log.debug(`working dir : ${this.locals.config.workingDir}`);
    if (!fs.existsSync(this.locals.config.workingDir)) {
      logger.enabledLevels.debug && log.debug(`creating working dir : "${this.locals.config.workingDir}"`);
      mkdirp.sync(this.locals.config.workingDir);
    }
    this.middlewares = {
      update: (req, res, next) => {
        if (req.query.update === '' || req.query.update === 'true') {
          this.init(this.config);
          return this.compute()
            .then(() => {
              const reqUrl = url.parse(req.url, true);
              const redirectUrl = _.omit(reqUrl, ['search', 'query', 'path', 'href']);
              redirectUrl.query = _.omit(reqUrl.query, ['update']);
              res.redirect(url.format(redirectUrl));
            });
        }
        next();
        return;
      },
      theme: (req, res, next) => {
        res.locals.theme = req.query.theme || this.locals.config.defaultTheme;
        res.locals.compiledTemplate = _.get(this.locals, ['compiledTemplates', 'doc', res.locals.theme]);
        if (!res.locals.compiledTemplate) {
          const theme = this.locals.config.themes[res.locals.theme];
          const templateFile = path.join(theme, this.locals.config.template);
          const htmlTemplate = fs.readFileSync(templateFile, 'utf8');
          res.locals.compiledTemplate = template(htmlTemplate);
          _.set(this.locals,
            ['compiledTemplates', 'doc', res.locals.theme],
            res.locals.compiledTemplate
          );
        }
        next();
      },
      assets: (req, res) => {
        res.sendFile(req.params[0], {root: this.locals.config.themes[res.locals.theme]});
      },
      home: (req, res) => {
        res.locals.indexCompiledTemplate = _.get(this.locals, ['compiledTemplates', 'index', res.locals.theme]);
        if (!res.locals.indexCompiledTemplate) {
          let htmlTemplate;
          if (this.locals.config.indexTemplate) {
            const theme = this.locals.config.themes[res.locals.theme];
            const templateFile = path.join(theme, this.locals.config.indexTemplate);
            try {
              htmlTemplate = fs.readFileSync(templateFile, 'utf8');
            } catch (err) {
              if (err.code !== 'ENOENT') {
                throw err;
              }
            }
          }
          htmlTemplate = htmlTemplate || `
        <h1>Welcome :-)</h1>
        <p>This is the root page of your docs, please select a doc to browse :</p>
        <% folders.forEach(folder => { %>
        <h3><a title="<%= folder.title %>" href="<%= folder.name %>/"><%= folder.title %></a></h3>
        <% }); %>
        `;
          res.locals.indexCompiledTemplate = template(htmlTemplate);
          _.set(this.locals,
            ['compiledTemplates', 'index', res.locals.theme],
            res.locals.indexCompiledTemplate
          );
        }
        const folders = Object.keys(this.locals.docs)
          .filter(key => /^\/[^\/]+\/$/.test(key))
          .map(item => {
            const name = item.split('/').join('');
            const title = (s => s.charAt(0).toUpperCase() + s.slice(1))(name.replace(/[\W]/g, ' '));
            return {name, title};
          });
        const body = res.locals.indexCompiledTemplate({folders});
        const html = res.locals.compiledTemplate({
          body,
          title: this.locals.config.defaultTitle
        });
        res.status(200).send(html);
      },
      doc: (req, res, next) => {
        const doc = _.get(this.locals, ['docs', req.path]);
        if (!doc) {
          if (_.get(this.locals, ['docs', req.path + '/'])) {
            res.redirect(req.path + '/');
            return;
          }
          res.sendFile(req.path, {root: this.locals.config.workingDir});
          return;
        }
        const content = doc && _.get(doc, 'content');
        if (!content) {
          next();
          return;
        }
        const html = res.locals.compiledTemplate({
          toc: content.toc,
          body: content.htmlContent,
          title: _.first(_.compact(req.path.split('/'))),
          repo: doc.repo
        });
        res.status(200).send(html);
      }
    };
    this.initialized = true;
  }

  updateGitRepo(repos, contentDir, cb) {
    const executeCmd = (command, ...opts) => {
      logger.enabledLevels.trace && log.trace(`execute comand "${command}"`);
      return Promise.promisify(childProcess.exec, {multiArgs: true})(command, ...opts);
    };
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
          const includeGit = this.locals.config.includeGit &&
            this.locals.config.mdExt.map(ext => `**/*.${ext}`)
              .concat(this.locals.config.includeGit)
              .join('\n');
          if (includeGit) {
            return executeCmd(`git init ${repo.name}`, {cwd: contentDir})
              .then(() => {
                const gitOpts = {cwd: path.join(contentDir, repo.name)};
                return executeCmd('git config core.sparseCheckout true', gitOpts)
                  .then(() => executeCmd(`echo "${includeGit}" > .git/info/sparse-checkout`, gitOpts))
                  .then(() => executeCmd(`git remote add -f origin ${cloneUrl}`, gitOpts))
                  /*.then(() => executeCmd(`git pull origin ${repo.branch || ''}`, gitOpts))*/
                  .then(() => executeCmd(`git checkout ${repo.branch || 'master'} --quiet`, gitOpts));
              });
          }
          return executeCmd(`git clone --quiet ${cloneUrl} ${repo.name}`, {cwd: contentDir});
        })
        .spread(handleStd)
        .return(result)
        .asCallback(cb);
    });
  }

  scanMdFiles(baseDir, opt = {}, cb) {
    opt.excludeDir = opt.excludeDir || this.locals.config.excludeDirs;
    const dir = opt.dir ? path.join(baseDir, opt.dir) : baseDir;
    logger.enabledLevels.debug && log.debug(`scanning markdown files from : ${dir}`);
    const relDir = path.relative(baseDir, dir);
    let p = fs.readdirAsync(dir);
    if (typeof opt.filterDir === 'function') {
      p = p.filter(opt.filterDir);
    } else {
      if (opt.includeDir) {
        p = p.filter(file => opt.includeDir.test(file));
      }
      if (opt.excludeDir) {
        p = p.filter(file => !opt.excludeDir.test(file));
      }
    }
    return p.reduce((found, file) => fs
      .statAsync(path.join(dir, file))
      .then(stats => {
        if (stats.isDirectory()) {
          return this.scanMdFiles(baseDir, Object.assign({}, opt, {dir: path.join(relDir, file)}))
            .then(childs => found.concat(childs || []));
        }
        if (typeof opt.filter === 'function') {
          if (!opt.filter(file)) {
            return found;
          }
        } else {
          if (opt.include) {
            if (!opt.include.test(file)) {
              return found;
            }
          }
          if (opt.exclude) {
            if (opt.exclude.test(file)) {
              return found;
            }
          }
        }
        file = path.join(relDir, file);
        logger.enabledLevels.trace && log.trace(`found file : ${file}`);
        return found.concat(file);
      }), [])
      .asCallback(cb);
  }

  computeDoc(file, cb) {
    logger.enabledLevels.debug && log.debug('computing doc file :', file);
    return fs.readFileAsync(path.join(this.locals.config.workingDir, file), 'utf8')
      .then(mdContent => this.buildDocHtml(mdContent))
      .then(content => {
        let filename = file.slice(0, -path.extname(file).length);
        if (this.locals.config.indexPattern) {
          if (this.locals.config.indexPattern.test(filename)) {
            filename = path.dirname(filename);
            if (filename === '.') {
              filename = '';
            } else {
              filename = filename + '/';
            }
          }
        }
        const uri = `/${filename}`;
        logger.enabledLevels.trace && log.trace(`register route ${uri} with file ${file}`);
        const repo = Object.assign({}, this.findRepo(this.getRepoName(file)));
        const repoBaseUrl = repo.url || repo.ssh;
        if (repoBaseUrl) {
          repo.fileUrl = repoBaseUrl + (
              repo.filePattern ?
                repo.filePattern
                  .replace('{{file}}', _.tail(_.compact(file.split('/'))).join('/'))
                  .replace('{{fileName}}', _.tail(_.compact(file.slice(0, -(path.extname(file).length))
                    .split('/')))
                    .join('/')) :
                ''
            );
        }
        _.set(this.locals, ['docs', uri], {file, content, repo});
      })
      .return(file)
      .asCallback(cb);
  }

  getRepoName(file) {
    return _.first(file.split('/'));
  }

  findRepo(repoName) {
    return repoName && _.find(this.locals.config.repos, {name: repoName});
  }

  buildDocHtml(mdContent) {
    const renderer = new marked.Renderer();
    const toc = [];
    renderer.heading = function(text, level, raw) {
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
      text = text.replace(/(<([^>]+)>)/ig, '');
      const id = accents
        .reduce((text, accent) => text.replace(accent.from, accent.to), raw)
        .replace(/['"]/, ' ')
        .toLowerCase()
        .replace(/[öäüÖÄÜ]/g, match => accents[match])
        .replace(/\W/, ' ').split(/\s/).join('-');
      if (level === 2) {
        toc.push({id, title: text});
      }
      return `<h${level} id="${id}">${raw}</h${level}>\n`;
    };
    const mdToHtml = Promise.promisify(marked);
    const mdOpts = {
      highlight: code => require('highlight.js').highlightAuto(code).value,
      breaks: true,
      smartypants: true,
      renderer
    };
    return mdToHtml(mdContent, mdOpts)
      .then(htmlContent => ({toc, htmlContent}));
  }

  buildExpressRouter() {
    const router = express.Router({caseSensitive: true});
    router.use(this.middlewares.update);
    router.use(this.middlewares.theme);
    router.use('/assets/*', this.middlewares.assets);
    router.get('/', this.middlewares.home);
    router.use(this.middlewares.doc);
    return router;
  }

  compute(config, cb) {
    if (typeof cb === 'undefined' && typeof config === 'function') {
      cb = config;
      config = null;
    }
    return Promise.resolve()
      .then(() => {
        if (!this.initialized) {
          this.init(config);
        }
        if (this.locals.config.repos) {
          return this.updateGitRepo(this.locals.config.repos, this.locals.config.workingDir);
        }
      })
      .then(() => {
        const mdExtPattern = this.locals.config.mdExt.join('|');
        const include = new RegExp(`\.(${mdExtPattern})$`);
        //this.locals.config.mdExtPattern
        ///\.(md|markdown)$/
        return this
          .scanMdFiles(this.locals.config.workingDir, {include})
          .each(file => this.computeDoc(file));
      })
      .asCallback(cb);
  }
}

exports = module.exports = ServeDown;

if (!module.parent || module.parent.filename === path.normalize(path.join(__dirname, '..', 'bin', 'servedown'))) {
  const homeDir = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
  const defaultConfigFile = path.join(homeDir, '.servedown.yml');
  const app = express();
  const servedown = new ServeDown(defaultConfigFile);
  const socket = process.env['SOCKET'];
  const port = process.env['PORT'] || 3000;
  if (socket) {
    if (fs.existsSync(socket)) {
      fs.unlinkSync(socket);
    }
  }
  servedown.init();
  app.use('/', servedown.buildExpressRouter());
  servedown.compute()
    .then(() => new Promise(resolve => app.listen(socket || port, resolve)))
    .then(() => {
      logger.enabledLevels.info && log.info('servedown server ready');
    });
}
