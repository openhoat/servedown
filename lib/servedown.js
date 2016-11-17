'use strict';

const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const YAML = require('yamljs');
const express = require('express');
const marked = require('marked');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const url = require('url');
const logger = require('hw-logger');
const log = logger.log;
const defaultConfig = require('./default-config');
const helper = require('./helper');
const pkg = helper.pkg;

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
    config = config || this.config;
    const configProps = Object.keys(defaultConfig).filter(item => !['themes'].includes(item));
    this.locals.config = Object.assign({}, defaultConfig, _.pick(config, configProps));
    _.merge(this.locals.config, _.pick(config, ['themes']));
    logger.enabledLevels.trace && log.trace('effective config :', this.locals.config);
    this.getConfig = _.get.bind(_, this.locals.config);
    if (!fs.existsSync(this.locals.config.srcDir)) {
      logger.enabledLevels.debug && log.debug(`creating source dir : "${this.locals.config.srcDir}"`);
      mkdirp.sync(this.locals.config.srcDir);
    }
    if (fs.existsSync(this.locals.config.metaDir)) {
      logger.enabledLevels.debug && log.debug(`destroying meta dir : "${this.locals.config.metaDir}"`);
      rimraf.sync(this.locals.config.metaDir);
    }
    logger.enabledLevels.debug && log.debug(`creating meta dir : "${this.locals.config.metaDir}"`);
    mkdirp.sync(this.locals.config.metaDir);
    const renderer = new marked.Renderer();
    _.forIn(this.getConfig('renderingRules', {}), (value, key) => {
      if (typeof value === 'function') {
        value = value.bind(this);
      }
      renderer[key] = value;
    });
    marked.setOptions(Object.assign({}, this.locals.config.htmlRender, {renderer}));
    this.initialized = true;
  }

  getDocMeta(key) {
    const metaFile = _.get(this.locals, ['docs', key]);
    return metaFile && JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  }

  preprocessContent(src) {
    const rules = this.getConfig('preprocessingRules', []);
    rules.forEach(rule => {
      src = src.replace(rule.pattern, rule.replace.bind(this));
    });
    return src;
  }

  buildDocUri(file) {
    let docUri = helper.withoutExt(file);
    const indexPattern = this.getConfig('indexPattern');
    if (indexPattern) {
      if (new RegExp(indexPattern, 'i').test(docUri)) {
        docUri = path.dirname(docUri);
        if (docUri === '.') {
          docUri = '';
        } else {
          docUri = docUri + '/';
        }
      }
    }
    return docUri;
  }

  processDoc(file) {
    logger.enabledLevels.debug && log.debug('processing doc :', file);
    this.processingFile = file;
    const mdContent = fs.readFileSync(path.join(this.getConfig('srcDir'), file), 'utf8');
    const content = this.buildDocHtml(mdContent);
    const filename = this.buildDocUri(file);
    const uri = `/${filename}`;
    logger.enabledLevels.trace && log.trace(`register route ${uri} with file ${file}`);
    const repo = Object.assign({}, helper.findRepo(helper.getRepoName(file), this.getConfig('repos')));
    const repoBaseUrl = repo.url || repo.ssh;
    if (repoBaseUrl) {
      repo.fileUrl = repoBaseUrl + (repo.filePattern
          ? repo.filePattern
          .replace('{{file}}', _.tail(_.compact(file.split('/'))).join('/'))
          .replace('{{fileName}}', _.tail(_.compact(file.slice(0, -(path.extname(file).length))
            .split('/')))
            .join('/'))
          : '');
    }
    const metaFile = path.join(this.getConfig('metaDir'), helper.withoutExt(file) + '.json');
    mkdirp.sync(path.dirname(metaFile));
    const meta = {mdFile: file, content, repo};
    fs.writeFileSync(metaFile, JSON.stringify(meta), 'utf8');
    _.set(this.locals, ['docs', uri], metaFile);
    return meta;
  }

  buildDocHtml(mdContent) {
    this.toc = [];
    const htmlContent = marked(this.preprocessContent(mdContent));
    return {toc: this.toc, mdContent, htmlContent};
  }

  buildExpressRouter() {
    const router = express.Router({caseSensitive: true});
    const middlewares = {
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
          this.process({context: res.locals.context});
          const reqUrl = url.parse(req.url, true);
          const redirectUrl = _.omit(reqUrl, ['search', 'query', 'path', 'href']);
          redirectUrl.query = _.omit(reqUrl.query, ['update']);
          res.redirect(url.format(redirectUrl));
        }
        next();
      },
      theme(req, res, next) {
        res.locals.theme = req.query.theme || (req.cookies && req.cookies.theme) || this.getConfig('defaultTheme');
        res.cookie('theme', res.locals.theme, {maxAge: 900000, httpOnly: true});
        res.locals.compiledTemplate = helper.getTemplate.call(this, {
          res,
          name: 'doc'
        });
        next();
      },
      assets(req, res, next) {
        res.sendFile(req.params[0], {root: this.getConfig('themes')[res.locals.theme]}, err => {
          if (!err) {
            return;
          }
          if (err.code === 'ENOENT') {
            next();
          } else {
            next(err);
          }
        });
      },
      searchForm(req, res) {
        res.locals.searchFormCompiledTemplate = helper.getTemplate.call(this, {
          res,
          name: 'searchform',
          defaultContent: this.getConfig('templateContents.searchform')
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
        const result = Object.keys(this.locals.docs || {})
          .reduce((matches, docName) => {
            const meta = this.getDocMeta(docName);
            const mdContent = _.get(meta, 'content.mdContent');
            const match = re.exec(mdContent);
            if (match) {
              matches.push({match, meta});
            }
            return matches;
          }, []);
        const docs = result.map(item => this.buildDocUri(item.meta.mdFile));
        res.locals.searchCompiledTemplate = helper.getTemplate.call(this, {
          res,
          name: 'search',
          defaultContent: this.getConfig('templateContents.search')
        });
        const body = res.locals.searchCompiledTemplate({q: req.query.q, docs});
        const html = res.locals.compiledTemplate({
          body,
          title: 'Search result',
          pkg
        });
        res.status(200).send(html);
      },
      home(req, res) {
        res.locals.indexCompiledTemplate = helper.getTemplate.call(this, {
          res,
          name: 'index',
          defaultContent: this.getConfig('templateContents.index')
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
          pkg,
          breadcrumb: _.compact(req.path.split('/'))
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
        const meta = JSON.parse(fs.readFileSync(docData, 'utf8'));
        let body = meta.content.htmlContent;
        if (req.query.highlight) {
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
          pkg,
          breadcrumb: _.compact(req.path.split('/'))
        });
        res.status(200).send(html);
      },
      notFound(req, res) {
        const html = res.locals.compiledTemplate({
          body: '<h3>Ooops… resource not found</h3>',
          title: this.getConfig('defaultTitle'),
          pkg,
          breadcrumb: helper.buildBreadcrumb(req)
        });
        logger.enabledLevels.warn && log.warn(`resource "${req.path}" not found`);
        res.status(200).send(html);
      },
      error(err, req, res, next) {
        if (res.headersSent) {
          return next(err);
        }
        logger.enabledLevels.debug && log.debug(err);
        const html = res.locals.compiledTemplate({
          body: `<h3>Ooops… an error occurred</h3><p>${err.toString()}</p>`,
          title: 'Error',
          pkg
        });
        res.status(500).send(html);
      }
    };
    router.use(logger.express());
    router.use(middlewares.context.bind(this));
    router.use(middlewares.update.bind(this));
    router.use(middlewares.theme.bind(this));
    router.use('/assets/*', middlewares.assets.bind(this));
    router.use('/search', middlewares.searchForm.bind(this));
    router.use(middlewares.search.bind(this));
    router.get('/', middlewares.home.bind(this));
    router.use(middlewares.doc.bind(this));
    router.use(middlewares.notFound.bind(this));
    router.use(middlewares.error.bind(this));
    logger.setLevel();
    return router;
  }

  process(opt) {
    opt = opt || {};
    if (!this.initialized) {
      this.init(opt.config);
    }
    const enableGit = this.getConfig('enableGit');
    const repos = this.getConfig('repos');
    if (enableGit && repos) {
      helper.updateGitRepo({
        repos: opt.context ? helper.findRepo(opt.context, repos) : repos,
        contentDir: this.getConfig('srcDir')
      });
    }
    const mdExtPattern = this.getConfig('markdownExt').join('|');
    const include = new RegExp(`\.(${mdExtPattern})$`);
    const files = helper
      .scanMdFiles({
        baseDir: this.getConfig('srcDir'),
        include,
        excludeDir: this.getConfig('excludeDir')
      });
    this.locals.contexts = _.uniq(files.map(file => _.first(file.split('/'))));
    files.forEach(file => {
      try {
        this.processDoc(file);
      } catch (err) {
        logger.enabledLevels.warn && log.warn(err);
      }
    });
    logger.enabledLevels.info && log.info('all docs processing done');
  }

  static start(config) {
    const cookieParser = require('cookie-parser');
    const app = express();
    const servedown = new ServeDown(config);
    servedown.init();
    app.use(cookieParser());
    app.use('/', servedown.buildExpressRouter());
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
    this.server = app.listen(listenOpts, () => {
      logger.enabledLevels.info && log.info('servedown is listening (%s)', JSON.stringify(listenOpts));
      if (process.send) {
        process.send('online');
      }
      servedown.process();
      logger.enabledLevels.info && log.info('servedown ready');
    });
    return servedown;
  }
}

exports = module.exports = ServeDown;

if (!module.parent || module.parent.filename === path.normalize(path.join(__dirname, '..', 'bin', 'servedown'))) {
  const homeDir = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
  const servedown = ServeDown.start(path.join(homeDir, '.servedown.yml'));
  process.on('message', message => {
    if (message === 'shutdown') {
      if (servedown.server) {
        servedown.server.close();
      }
      process.exit(0);
    }
  });
}
