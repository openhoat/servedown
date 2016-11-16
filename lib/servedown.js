'use strict';

const Promise = require('bluebird');
const path = require('path');
const _ = require('lodash');
const YAML = require('yamljs');
const express = require('express');
const marked = require('marked');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
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
          config = YAML.parse(helper.fs.readFileSync(this.config, 'utf8'));
        } else if (ext === '.js') {
          config = require(this.config);
        } else if (ext === '.json') {
          config = JSON.parse(helper.fs.readFileSync(this.config, 'utf8'));
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
    if (!helper.fs.existsSync(this.locals.config.srcDir)) {
      logger.enabledLevels.debug && log.debug(`creating source dir : "${this.locals.config.srcDir}"`);
      mkdirp.sync(this.locals.config.srcDir);
    }
    if (helper.fs.existsSync(this.locals.config.metaDir)) {
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
    this.mdToHtml = Promise.promisify(marked);
    this.mdToHtml.setOptions(Object.assign({}, this.locals.config.htmlRender, {renderer}));
    this.initialized = true;
  }

  getDocMeta(key, cb) {
    return Promise.resolve()
      .then(() => {
        const metaFile = _.get(this.locals, ['docs', key]);
        return metaFile && helper.fs.readFileAsync(metaFile, 'utf8')
            .then(JSON.parse);
      })
      .asCallback(cb);
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

  processDoc(file, cb) {
    logger.enabledLevels.debug && log.debug('processing doc :', file);
    this.processingFile = file;
    return helper.fs.readFileAsync(path.join(this.getConfig('srcDir'), file), 'utf8')
      .then(mdContent => this.buildDocHtml(mdContent))
      .then(content => {
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
        helper.fs.writeFileSync(metaFile, JSON.stringify(meta), 'utf8');
        _.set(this.locals, ['docs', uri], metaFile);
        return meta;
      })
      .asCallback(cb);
  }

  buildDocHtml(mdContent) {
    this.toc = [];
    return this.mdToHtml(this.preprocessContent(mdContent))
      .then(htmlContent => ({toc: this.toc, mdContent, htmlContent}));
  }

  buildExpressRouter() {
    const router = express.Router({caseSensitive: true});
    router.use(logger.express());
    router.use(helper.middlewares.context.bind(this));
    router.use(helper.middlewares.update.bind(this));
    router.use(helper.middlewares.theme.bind(this));
    router.use('/assets/*', helper.middlewares.assets.bind(this));
    router.use('/search', helper.middlewares.searchForm.bind(this));
    router.use(helper.middlewares.search.bind(this));
    router.get('/', helper.middlewares.home.bind(this));
    router.use(helper.middlewares.doc.bind(this));
    router.use(helper.middlewares.notFound.bind(this));
    router.use(helper.middlewares.error.bind(this));
    logger.setLevel();
    return router;
  }

  process(opt, cb) {
    if (typeof cb === 'undefined' && typeof opt === 'function') {
      cb = opt;
      opt = null;
    }
    opt = opt || {};
    return Promise.resolve()
      .then(() => {
        if (!this.initialized) {
          this.init(opt.config);
        }
      })
      .then(() => {
        const enableGit = this.getConfig('enableGit');
        const repos = this.getConfig('repos');
        if (enableGit && repos) {
          return helper.updateGitRepo({
            repos: opt.context ? helper.findRepo(opt.context, repos) : repos,
            contentDir: this.getConfig('srcDir')
          });
        }
      })
      .then(() => {
        const mdExtPattern = this.getConfig('markdownExt').join('|');
        const include = new RegExp(`\.(${mdExtPattern})$`);
        return helper
          .scanMdFiles({
            baseDir: this.getConfig('srcDir'),
            include,
            excludeDir: this.getConfig('excludeDir')
          })
          .then(files => {
            this.locals.contexts = _.uniq(files.map(file => _.first(file.split('/'))));
            return files;
          })
          .each(file => this.processDoc(file));
      })
      .then(() => {
        logger.enabledLevels.info && log.info('all docs processing done');
      })
      .asCallback(cb);
  }

  static start(config) {
    const app = express();
    const servedown = new ServeDown(config);
    servedown.init();
    app.use('/', servedown.buildExpressRouter());
    return Promise.resolve()
      .then(() => {
        const listenOpts = {};
        const socket = servedown.getConfig('server.socket');
        if (socket) {
          if (helper.fs.existsSync(socket)) {
            helper.fs.unlinkSync(socket);
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
      .then(() => servedown.process())
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
