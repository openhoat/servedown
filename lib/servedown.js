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
    this.config = config || this.config;
    logger.enabledLevels.debug && log.debug(`initializing ${pkg.name} instance with :`, JSON.stringify(this.config));
    if (typeof this.config === 'string') {
      const ext = path.extname(this.config).toLowerCase();
      try {
        if (ext === '.yml' || ext === '.yaml') {
          config = YAML.parse(fs.readFileSync(this.config, 'utf8'));
        } else if (ext === '.js') {
          config = require(this.config);
        } else if (ext === '.json') {
          config = JSON.parse(fs.readFileSync(this.config, 'utf8'));
        } else if (ext === '.properties') {
          const properties = require('properties');
          config = properties.parse(fs.readFileSync(this.config, 'utf8'), {
            namespaces: true,
            variables: true,
            sections: true
          });
        } else {
          logger.enabledLevels.warn && log.warn(`Configuration format "${ext}" not supported : ignore`);
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
        logger.enabledLevels.warn && log.warn(`configuration file (${this.locals.config}) not found : ignore`);
      }
    }
    const configProps = Object.keys(defaultConfig).filter(item => item !== 'themes');
    this.locals.config = Object.assign({}, defaultConfig, _.pick(config, configProps));
    _.merge(this.locals.config, _.pick(config, ['themes']));
    logger.enabledLevels.trace && log.trace('effective config :', this.locals.config);
    logger.enabledLevels.debug && log.debug(`working dir : ${this.locals.config.workingDir}`);
    if (!fs.existsSync(this.locals.config.workingDir)) {
      logger.enabledLevels.debug && log.debug(`creating working dir : "${this.locals.config.workingDir}"`);
      mkdirp.sync(this.locals.config.workingDir);
    }
    this.renderer = new marked.Renderer();
    this.renderer.heading = (text, level, raw) => {
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
        this.toc.push({id, title: text});
      }
      return `<h${level} id="${id}">${raw}</h${level}>\n`;
    };
    this.mdToHtml = Promise.promisify(marked);
    this.customRules = [{
      pattern: /[{]{6}[\s]*([\w-]*)[\r\n]+((((?![}]{6}).)|[\r\n])*)[\r\n\s]+[}]{6}/gm,
      replace: (raw, style, content) => {
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
    }];
    this.initialized = true;
  }

  mwUpdate(req, res, next) {
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
  }

  mwTheme(req, res, next) {
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
  }

  mwAssets(req, res) {
    res.sendFile(req.params[0], {root: this.locals.config.themes[res.locals.theme]});
  }

  mwSearch(req, res, next) {
    if (!req.query.q) {
      return next();
    }
    const re = new RegExp(req.query.q, 'gmi');
    const matches = [];
    for (const docName in this.locals.docs) {
      const doc = this.locals.docs[docName];
      const mdContent = _.get(doc, 'content.mdContent');
      //log.debug('mdContent :', mdContent);
      const match = re.exec(mdContent);
      if (match) {
        //log.warn('match :', match);
        matches.push({match, doc});
      }
    }
    log.debug('matches :', matches);
    const docs = matches.map(match => this.buildFileUri(match.doc.file));
    res.locals.searchCompiledTemplate = _.get(this.locals, ['compiledTemplates', 'search', res.locals.theme]);
    if (!res.locals.searchCompiledTemplate) {
      let templateContent;
      if (this.locals.config.searchTemplate) {
        const theme = this.locals.config.themes[res.locals.theme];
        const templateFile = path.join(theme, this.locals.config.searchTemplate);
        try {
          templateContent = fs.readFileSync(templateFile, 'utf8');
        } catch (err) {
          if (err.code !== 'ENOENT') {
            throw err;
          }
        }
      }
      templateContent = templateContent ||
        [
          '<h3>Search result matching : <q>${q}</q></h3>',
          '<% if (docs.length) { %>',
          '<ul>',
          '<% docs.forEach(doc => { %><li><a href="${doc}?highlight=${q}">${doc}</a></li><% });%>',
          '</ul>',
          '<% } else { %>',
          '<p><strong>Ooops... it seems that no content matches your query :-(</strong></p>',
          '<% } %>'
        ].join('\n');
      res.locals.searchCompiledTemplate = template(templateContent);
      _.set(this.locals,
        ['compiledTemplates', 'search', res.locals.theme],
        res.locals.searchCompiledTemplate
      );
    }
    const body = res.locals.searchCompiledTemplate({q: req.query.q, docs});
    const html = res.locals.compiledTemplate({
      body,
      title: this.locals.config.defaultTitle,
      pkg
    });
    res.status(200).send(html);
  }

  mwHome(req, res) {
    res.locals.indexCompiledTemplate = _.get(this.locals, ['compiledTemplates', 'index', res.locals.theme]);
    if (!res.locals.indexCompiledTemplate) {
      let templateContent;
      if (this.locals.config.indexTemplate) {
        const theme = this.locals.config.themes[res.locals.theme];
        const templateFile = path.join(theme, this.locals.config.indexTemplate);
        try {
          templateContent = fs.readFileSync(templateFile, 'utf8');
        } catch (err) {
          if (err.code !== 'ENOENT') {
            throw err;
          }
        }
      }
      templateContent = templateContent ||
        [
          '<h1>Welcome :-)</h1>',
          '<p>This is the root page of your docs, please select a doc to browse :</p>',
          '<% folders.forEach(folder => { %>',
          '<h3><a title="<%= folder.title %>" href="<%= folder.name %>/"><%= folder.title %></a></h3>',
          '<% }); %>'
        ].join('\n');
      res.locals.indexCompiledTemplate = template(templateContent);
      _.set(this.locals,
        ['compiledTemplates', 'index', res.locals.theme],
        res.locals.indexCompiledTemplate
      );
    }
    const folders = this.locals.docs
      && Object.keys(this.locals.docs)
        .filter(key => /^\/[^\/]+\/$/.test(key))
        .map(item => {
          const name = item.split('/').join('');
          const title = (s => s.charAt(0).toUpperCase() + s.slice(1))(name.replace(/[\W]/g, ' '));
          return {name, title};
        })
      || [];
    const body = res.locals.indexCompiledTemplate({folders});
    const html = res.locals.compiledTemplate({
      body,
      title: this.locals.config.defaultTitle,
      pkg
    });
    res.status(200).send(html);
  }

  mwDoc(req, res, next) {
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
    let html = res.locals.compiledTemplate({
      toc: content.toc,
      body: content.htmlContent,
      title: _.first(_.compact(req.path.split('/'))),
      repo: doc.repo,
      pkg
    });
    if (req.query.highlight) {
      const re = new RegExp(`(${req.query.highlight})`, 'gmi');
      html = html.replace(re, '<span class="highlight">$1</span>');
    }
    res.status(200).send(html);
  }

  preprocessContent(src) {
    this.customRules.forEach(rule => {
      src = src.replace(rule.pattern, rule.replace);
    });
    return src;
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
          const includeGit = this.locals.config.repoInclude &&
            this.locals.config.markdownExt.map(ext => `**/*.${ext}`)
              .concat(this.locals.config.repoInclude)
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
  }

  scanMdFiles(baseDir, opt = {}, cb) {
    opt.excludeDir = opt.excludeDir || this.locals.config.excludeDir;
    const dir = opt.dir ? path.join(baseDir, opt.dir) : baseDir;
    logger.enabledLevels.debug && log.debug(`scanning markdown files from : ${dir}`);
    const relDir = path.relative(baseDir, dir);
    let p = fs.readdirAsync(dir);
    if (typeof opt.filterDir === 'function') {
      p = p.filter(opt.filterDir);
    } else {
      if (opt.includeDir) {
        const includeDir = new RegExp(opt.includeDir);
        p = p.filter(file => includeDir.test(file));
      }
      if (opt.excludeDir) {
        const excludeDir = new RegExp(opt.excludeDir);
        p = p.filter(file => !excludeDir.test(file));
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

  buildFileUri(file) {
    let filename = file.slice(0, -path.extname(file).length);
    if (this.locals.config.indexPattern) {
      if (new RegExp(this.locals.config.indexPattern, 'i').test(filename)) {
        filename = path.dirname(filename);
        if (filename === '.') {
          filename = '';
        } else {
          filename = filename + '/';
        }
      }
    }
    return filename;
  }

  computeDoc(file, cb) {
    logger.enabledLevels.debug && log.debug('computing doc file :', file);
    return fs.readFileAsync(path.join(this.locals.config.workingDir, file), 'utf8')
      .then(mdContent => this.buildDocHtml(mdContent))
      .then(content => {
        const filename = this.buildFileUri(file);
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
    this.toc = [];
    const mdOpts = {
      highlight: code => require('highlight.js').highlightAuto(code).value,
      breaks: true,
      smartypants: true,
      renderer: this.renderer
    };
    this.mdToHtml.setOptions(mdOpts);
    return this.mdToHtml(this.preprocessContent(mdContent))
      .then(htmlContent => ({toc: this.toc, mdContent, htmlContent}));
  }

  buildExpressRouter() {
    const router = express.Router({caseSensitive: true});
    router.use(this.mwUpdate.bind(this));
    router.use(this.mwTheme.bind(this));
    router.use('/assets/*', this.mwAssets.bind(this));
    router.use(this.mwSearch.bind(this));
    router.get('/', this.mwHome.bind(this));
    router.use(this.mwDoc.bind(this));
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
        if (this.locals.config.enableGit && this.locals.config.repos) {
          return this.updateGitRepo(this.locals.config.repos, this.locals.config.workingDir);
        }
      })
      .then(() => {
        const mdExtPattern = this.locals.config.markdownExt.join('|');
        const include = new RegExp(`\.(${mdExtPattern})$`);
        return this
          .scanMdFiles(this.locals.config.workingDir, {include})
          .each(file => this.computeDoc(file));
      })
      .asCallback(cb);
  }

  getConfig(key) {
    return _.get(this.locals.config, key);
  }

  static start(config) {
    const app = express();
    const servedown = new ServeDown(config);
    servedown.init();
    app.use('/', servedown.buildExpressRouter());
    return servedown.compute()
      .then(() => {
        const listenOpts = {};
        const socket = servedown.getConfig('server.socket');
        if (socket) {
          if (fs.existsSync(socket)) {
            fs.unlinkSync(socket);
          }
          listenOpts.path = socket;
        } else {
          const port = servedown.getConfig('server.port');
          if (port) {
            listenOpts.port = parseInt(port);
          }
          listenOpts.host = servedown.getConfig('server.host');
        }
        return new Promise(
          resolve => {
            this.server = app.listen(listenOpts, resolve);
          })
          .then(() => {
            logger.enabledLevels.info && log.info('servedown is listening (%s)', JSON.stringify(listenOpts));
          });
      })
      .then(() => {
        if (process.send) {
          process.send('online');
        }
      })
      .return(servedown);
  }
}

exports = module.exports = ServeDown;

if (!module.parent || module.parent.filename === path.normalize(path.join(__dirname, '..', 'bin', 'servedown'))) {
  const homeDir = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
  ServeDown.start(path.join(homeDir, '.servedown.yml'))
    .then(servedown => {
      process.on('message', message => {
        if (message === 'shutdown') {
          if (servedown.server) {
            servedown.server.close();
          }
          process.exit(0);
        }
      });
    });
}
