const path = require('path')
const Promise = require('bluebird')
const fs = require('fs')
const _ = require('lodash')
const template = require('lodash.template')
const YAML = require('yamljs')
const express = require('express')
const marked = require('marked')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const url = require('url')
const cacheManager = require('cache-manager')
const fsStore = require('cache-manager-fs')
const logger = require('hw-logger')
const log = logger.log
const defaultConfig = require('./default-config')
const helper = require('./helper')
const pkg = helper.pkg

class ServeDown {

  constructor(config) {
    this.config = config
    logger.enabledLevels.trace && log.trace(`${pkg.name} instance created`)
  }

  init(config) {
    this.config = config || this.config
    logger.enabledLevels.debug && log.debug(`initializing ${pkg.name} instance with :`, JSON.stringify(this.config))
    if (typeof this.config === 'string') {
      const ext = path.extname(this.config).toLowerCase()
      try {
        if (ext === '.yml' || ext === '.yaml') {
          config = YAML.parse(fs.readFileSync(this.config, 'utf8'))
        } else if (ext === '.js') {
          config = require(this.config)
        } else if (ext === '.json') {
          config = JSON.parse(fs.readFileSync(this.config, 'utf8'))
        } else {
          logger.enabledLevels.warn && log.warn(`configuration format "${ext}" not supported : ignore`)
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err
        }
        logger.enabledLevels.warn && log.warn(`configuration file (${this.locals.config}) not found : ignore`)
      }
    }
    config = config || this.config
    const configProps = Object.keys(defaultConfig).filter(item => !['themes'].includes(item))
    this.locals = {
      config: Object.assign({}, defaultConfig, _.pick(config, configProps))
    }
    _.merge(this.locals.config, _.pick(config, ['themes']))
    logger.enabledLevels.trace && log.trace('effective config :', this.locals.config)
    this.getConfig = _.get.bind(_, this.locals.config)
    if (this.locals.config.cacheDir) {
      if (fs.existsSync(this.locals.config.cacheDir)) {
        logger.enabledLevels.debug && log.debug(`destroying cache dir : "${this.locals.config.cacheDir}"`)
        rimraf.sync(this.locals.config.cacheDir)
      }
      logger.enabledLevels.debug && log.debug(`creating cache dir : "${this.locals.config.cacheDir}"`)
      mkdirp.sync(this.locals.config.cacheDir)
    }
    const cacheConfig = {
      store: fsStore,
      options: Object.assign({
        path: this.locals.config.cacheDir,
        preventfill: true
      }, this.locals.config.cache)
    }
    logger.enabledLevels.trace && log.trace('initializing cache manager with :', cacheConfig)
    this.cache = cacheManager.caching(cacheConfig)
    if (!fs.existsSync(this.locals.config.srcDir)) {
      logger.enabledLevels.debug && log.debug(`creating source dir : "${this.locals.config.srcDir}"`)
      mkdirp.sync(this.locals.config.srcDir)
    }
    const renderer = new marked.Renderer()
    _.forIn(this.getConfig('renderingRules', {}), (value, key) => {
      if (typeof value === 'function') {
        value = value.bind(this)
      }
      renderer[key] = value
    })
    marked.setOptions(Object.assign({}, this.locals.config.htmlRender, {renderer}))
    this.initialized = true
    return this
  }

  getDocMeta(key, cb) {
    return Promise.fromCallback(this.cache.get.bind(this.cache, key, {})).asCallback(cb)
  }

  getTemplate({res, name, defaultContent = 'Empty content'}, cb) {
    return Promise.resolve()
      .then(() => {
        const tpl = _.get(this.locals, ['compiledTemplates', name, res.locals.theme])
        if (tpl) {
          return tpl
        }
        const templateFile = this.getConfig(['templates', name])
        if (templateFile) {
          const theme = this.getConfig('themes')[res.locals.theme]
          return fs.readFileAsync(path.join(theme, templateFile), 'utf8')
            .catch({code: 'ENOENT'}, err => {
              logger.enabledLevels.trace && log.trace(err)
            })
            .then(templateContent => {
              templateContent = templateContent || defaultContent
              const tpl = template(templateContent)
              _.set(this.locals, ['compiledTemplates', name, res.locals.theme], tpl)
              return tpl
            })
        }
      })
      .asCallback(cb)
  }

  preprocessContent(src) {
    const rules = this.getConfig('preprocessingRules', [])
    rules.forEach(rule => {
      src = src.replace(rule.pattern, rule.replace.bind(this))
    })
    return src
  }

  buildDocUri(file) {
    let docUri = helper.withoutExt(file)
    const indexPattern = this.getConfig('indexPattern')
    if (indexPattern) {
      if (new RegExp(indexPattern, 'i').test(docUri)) {
        docUri = path.dirname(docUri)
        if (docUri === '.') {
          docUri = ''
        } else {
          docUri = docUri + '/'
        }
      }
    }
    return docUri
  }

  processDoc(file, cb) {
    return Promise.resolve()
      .then(() => {
        logger.enabledLevels.debug && log.debug('processing doc :', file)
        this.processingFile = file
        return fs.readFileAsync(path.join(this.getConfig('srcDir'), file), 'utf8')
      })
      .then(mdContent => {
        const content = this.buildDocHtml(mdContent)
        const filename = this.buildDocUri(file)
        const uri = `/${filename}`
        logger.enabledLevels.trace && log.trace(`register route ${uri} with file ${file}`)
        const repo = Object.assign({}, helper.findRepo(helper.getRepoName(file), this.getConfig('repos')))
        const repoBaseUrl = repo.url || repo.ssh
        if (repoBaseUrl) {
          repo.fileUrl = repoBaseUrl + (repo.filePattern
              ? repo.filePattern
              .replace('{{file}}', _.tail(_.compact(file.split('/'))).join('/'))
              .replace('{{fileName}}', _.tail(_.compact(file.slice(0, -(path.extname(file).length))
                .split('/')))
                .join('/'))
              : '')
        }
        const meta = {mdFile: file, content, repo}
        return Promise.fromCallback(this.cache.set.bind(this.cache, uri, meta))
      })
      .asCallback(cb)
  }

  buildDocHtml(mdContent) {
    this.toc = []
    const htmlContent = marked(this.preprocessContent(mdContent))
    return {toc: this.toc, mdContent, htmlContent}
  }

  expressMwContext(req, res, next) {
    if (res.headersSent) {
      return next()
    }
    logger.enabledLevels.trace && log.trace('applying middleware "context" for request :', req.originalUrl)
    const context = _.first(_.compact(req.path.split('/')))
    if (Array.isArray(this.locals.contexts) && this.locals.contexts.includes(context)) {
      res.locals.context = context
    }
    next()
  }

  expressMwUpdate(req, res, next) {
    if (res.headersSent) {
      return next()
    }
    logger.enabledLevels.trace && log.trace('applying middleware "update" for request :', req.originalUrl)
    return Promise.resolve()
      .then(() => {
        if (!this.getConfig('updateQuery') || !(req.query.update === '' || req.query.update === 'true')) {
          return
        }
        this.init(this.config)
        return this.process({context: res.locals.context})
          .then(() => {
            const reqUrl = url.parse(req.url, true)
            const redirectUrl = _.omit(reqUrl, ['search', 'query', 'path', 'href'])
            redirectUrl.query = _.omit(reqUrl.query, ['update'])
            res.redirect(url.format(redirectUrl))
          })
      })
      .then(() => next(), next)
  }

  expressMwTheme(req, res, next) {
    if (res.headersSent) {
      return next()
    }
    logger.enabledLevels.trace && log.trace('applying middleware "theme" for request :', req.originalUrl)
    return Promise.resolve()
      .then(() => {
        res.locals.theme = req.query.theme || (req.cookies && req.cookies.theme) || this.getConfig('defaultTheme')
        if (req.query.theme === res.locals.theme) {
          _.unset(this.locals, 'compiledTemplates')
        }
        res.cookie('theme', res.locals.theme, {maxAge: 900000, httpOnly: true})
        return this.getTemplate({
          res,
          name: 'doc',
          defaultContent: this.getConfig('templateContents.doc')
        })
      })
      .then(template => {
        res.locals.compiledTemplate = template
      })
      .then(() => next(), next)
  }

  expressMwAssets(req, res, next) {
    if (res.headersSent) {
      return next()
    }
    logger.enabledLevels.trace && log.trace('applying middleware "assets" for request :', req.originalUrl)
    return Promise
      .fromCallback(res.sendFile.bind(res, req.params[0], {root: this.getConfig('themes')[res.locals.theme]}))
      .catch({code: 'ENOENT'}, err => Promise.resolve())
      .then(() => next(), next)
  }

  expressMwSearchForm(req, res, next) {
    if (res.headersSent) {
      return next()
    }
    logger.enabledLevels.trace && log.trace('applying middleware "searchForm" for request :', req.originalUrl)
    return this
      .getTemplate({
        res,
        name: 'searchform',
        defaultContent: this.getConfig('templateContents.searchform')
      })
      .then(template => {
        res.locals.searchFormCompiledTemplate = template
        const body = template()
        const html = res.locals.compiledTemplate({
          body,
          title: 'Search',
          pkg
        })
        res.status(200).send(html)
      })
      .catch(next)
  }

  expressMwSearch(req, res, next) {
    if (res.headersSent) {
      return next()
    }
    logger.enabledLevels.trace && log.trace('applying middleware "search" for request :', req.originalUrl)
    return Promise.resolve()
      .then(() => {
        if (!req.query.q) {
          return
        }
        const re = new RegExp(`((${req.query.q})(?![^<]*>|[^<>]*</))`, 'gmi')
        return Promise.fromCallback(this.cache.keys.bind(this.cache))
          .reduce((matches, docName) => this.getDocMeta(docName)
            .then(meta => {
              const mdContent = _.get(meta, 'content.mdContent')
              const match = re.exec(mdContent)
              if (match) {
                matches.push({match, meta})
              }
              return matches
            }), []
          )
          .then(result => {
            const docs = result.map(item => this.buildDocUri(item.meta.mdFile))
            return this
              .getTemplate({
                res,
                name: 'search',
                defaultContent: this.getConfig('templateContents.search')
              })
              .then(template => {
                res.locals.searchCompiledTemplate = template
                const body = template({q: req.query.q, docs})
                const html = res.locals.compiledTemplate({
                  body,
                  title: 'Search result',
                  pkg
                })
                res.status(200).send(html)
              })
          })
      })
      .then(() => next(), next)
  }

  expressMwHome(req, res, next) {
    if (res.headersSent) {
      return next()
    }
    logger.enabledLevels.trace && log.trace('applying middleware "home" for request :', req.originalUrl)
    return this
      .getTemplate({
        res,
        name: 'index',
        defaultContent: this.getConfig('templateContents.index')
      })
      .then(template => {
        res.locals.indexCompiledTemplate = template
        const folders = (this.locals.contexts || [])
          .map(item => {
            const name = item.split('/').join('')
            const title = (s => s.charAt(0).toUpperCase() + s.slice(1))(name.replace(/[\W]/g, ' '))
            return {name, title}
          })
        const body = template({folders})
        const html = res.locals.compiledTemplate({
          body,
          title: this.getConfig('defaultTitle'),
          pkg
        })
        res.status(200).send(html)
      })
      .catch(next)
  }

  expressMwDoc(req, res, next) {
    if (res.headersSent) {
      return next()
    }
    logger.enabledLevels.trace && log.trace('applying middleware "doc" for request :', req.originalUrl)
    return this.getDocMeta(req.path)
      .then(meta => {
        if (!meta) {
          return Promise.fromCallback(this.cache.keys.bind(this.cache))
            .then(keys => {
              if (keys && keys.includes(req.path + '/')) {
                return res.redirect(req.path + '/')
              }
              return Promise.fromCallback(res.sendFile.bind(res, req.path, {root: this.getConfig('srcDir')}))
            })
        }
        let body = meta.content.htmlContent
        if (req.query.highlight) {
          try {
            const re = new RegExp(`(${req.query.highlight}(?!([^<]+)?>))`, 'gi')
            body = body.replace(re, '<span class="highlight">$1</span>')
          } catch (err) {
            logger.enabledLevels.warn && log.warn(err)
          }
        }
        const html = res.locals.compiledTemplate({
          toc: meta.content.toc,
          body,
          title: _.first(_.compact(req.path.split('/'))),
          repo: meta.repo,
          pkg,
          breadcrumb: helper.buildBreadcrumb(req.path)
        })
        res.status(200).send(html)
      })
      .catch({code: 'ENOENT'}, err => next())
      .catch(next)
  }

  expressMwNotFound(req, res) {
    if (res.headersSent) {
      return
    }
    logger.enabledLevels.trace && log.trace('applying middleware "notFound" for request :', req.originalUrl)
    const html = res.locals.compiledTemplate({
      body: '<h3>Ooops… resource not found</h3>',
      title: this.getConfig('defaultTitle'),
      pkg
    })
    logger.enabledLevels.warn && log.warn(`resource "${req.path}" not found`)
    res.status(404).send(html)
  }

  expressMwError(err, req, res, next) {
    logger.enabledLevels.debug && log.debug(err)
    if (res.headersSent) {
      return next(err)
    }
    logger.enabledLevels.trace && log.trace('applying middleware "error" for request :', req.originalUrl)
    if (typeof res.locals.compiledTemplate !== 'function') {
      return next(err)
    }
    const html = res.locals.compiledTemplate({
      body: `<h3>Ooops… an error occurred</h3><p>${err.toString()}</p>`,
      title: 'Error',
      pkg
    })
    res.status(500).send(html)
  }

  buildExpressRouter() {
    const router = express.Router({caseSensitive: true})
    router.use(logger.express())
    router.use(this.expressMwContext.bind(this))
    router.use(this.expressMwUpdate.bind(this))
    router.use(this.expressMwTheme.bind(this))
    router.use('/assets/*', this.expressMwAssets.bind(this))
    router.use('/search', this.expressMwSearchForm.bind(this))
    router.use(this.expressMwSearch.bind(this))
    router.get('/', this.expressMwHome.bind(this))
    router.use(this.expressMwDoc.bind(this))
    router.use(this.expressMwNotFound.bind(this))
    router.use(this.expressMwError.bind(this))
    logger.setLevel()
    return router
  }

  process(opt, cb) {
    if (typeof cb === 'undefined' && typeof opt === 'function') {
      cb = opt
      opt = null
    }
    opt = opt || {}
    return Promise.resolve()
      .then(() => {
        if (!this.initialized) {
          this.init(opt.config)
        }
      })
      .then(() => {
        const enableGit = this.getConfig('enableGit')
        const repos = this.getConfig('repos')
        if (enableGit && repos) {
          return helper.updateGitRepo({
            repos: opt.context ? helper.findRepo(opt.context, repos) : repos,
            contentDir: this.getConfig('srcDir'),
            repoInclude: this.getConfig('repoInclude'),
            extInclude: ['yml', 'yaml'].concat(this.getConfig('markdownExt'))
          })
        }
      })
      .then(() => {
        const includePattern = this.getConfig('markdownExt').join('|')
        const include = new RegExp(`\.(${includePattern})$`)
        return helper.scanMdFiles({
          baseDir: this.getConfig('srcDir'),
          include,
          excludeDir: this.getConfig('excludeDir')
        })
      })
      .then(files => {
        this.locals.contexts = _.uniq(files.map(file => _.first(file.split('/'))))
        return files
      })
      .each(file => this.processDoc(file)
        .catch(err => {
          logger.enabledLevels.warn && log.warn(err)
        })
      )
      .then(() => {
        logger.enabledLevels.info && log.info('all docs processing done')
      })
      .return(this)
      .asCallback(cb)
  }

  start(opt, cb) {
    if (typeof cb === 'undefined' && typeof opt === 'function') {
      cb = opt
      opt = null
    }
    opt = opt || {}
    return Promise.resolve()
      .then(() => {
        if (!this.initialized) {
          this.init(opt.config)
        }
      })
      .then(() => {
        logger.enabledLevels.info && log.info(`starting ${pkg.name} server`)
        this.expressApp = express()
        const cookieParser = require('cookie-parser')
        this.expressApp.use(cookieParser())
        this.expressApp.use('/', this.buildExpressRouter())
        return Promise.resolve()
          .then(() => {
            const socket = this.getConfig('server.socket')
            if (socket) {
              return fs.existsAsync(socket)
                .then(exists => {
                  if (exists) {
                    return fs.unlinkAsync(socket)
                  }
                })
                .then(() => ({path: socket}))
            } else {
              const listenOpts = {host: this.getConfig('server.host')}
              const port = this.getConfig('server.port')
              if (port) {
                listenOpts.port = parseInt(port)
              }
              return listenOpts
            }
          })
          .then(listenOpts => Promise
            .fromCallback(cb => {
              this.server = this.expressApp.listen(listenOpts, cb)
            })
            .then(() => {
              logger.enabledLevels.info && log.info(`${pkg.name} server is listening (%s)`, JSON.stringify(listenOpts))
              if (process.send) {
                process.send('online')
              }
            })
          )
          .then(() => this.process(opt))
          .then(() => {
            logger.enabledLevels.info && log.info(`${pkg.name} ready`)
          })
          .return(this)
      })
      .asCallback(cb)
  }

  stop(opt, cb) {
    return Promise.resolve()
      .then(() => {
        if (!this.server) {
          return
        }
        logger.enabledLevels.info && log.info(`stopping ${pkg.name} server`)
        return Promise.fromCallback(this.server.close.bind(this.server))
          .then(() => {
            logger.enabledLevels.info && log.info(`${pkg.name} server closed`)
          })
      })
      .asCallback(cb)
  }

  static start(config, cb) {
    return (new ServeDown(config)).start()
      .asCallback(cb)
  }
}

exports = module.exports = ServeDown

if (!module.parent || module.parent.filename === path.normalize(path.join(__dirname, '..', 'bin', pkg.name))) {
  ServeDown.start(path.join(helper.homeDir, `.${pkg.name}.yml`))
    .then(servedown => {
      process.on('SIGINT', () => servedown.stop())
      process.on('message', message => {
        if (message === 'shutdown') {
          servedown.stop()
        }
      })
    })
    .catch(err => {
      logger.enabledLevels.error && log.error(err)
      process.exit(1)
    })
}
