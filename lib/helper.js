const path = require('path')
const Promise = require('bluebird')
const fs = require('fs')
const _ = require('lodash')
const childProcess = require('child_process')
const logger = require('hw-logger')
const log = logger.log
const pkg = require('../package.json')
const homeDir = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME']
const baseDir = path.join(__dirname, '..')
const exec = Promise.promisify(childProcess.exec, {multiArgs: true})
Promise.promisifyAll(fs)
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
]

const helper = {
  pkg,
  homeDir,
  baseDir,
  executeCmd: (command, ...opts) => {
    command = command.trim()
    logger.enabledLevels.debug && log.debug(`execute command "${command}"`)
    return exec(command, ...opts)
      .spread((stdout, stderr) => {
        if (stdout) {
          logger.enabledLevels.debug && log.debug(stdout)
        }
        if (stderr) {
          logger.enabledLevels.warn && log.warn(stderr)
        }
        return {stdout, stderr}
      })
  },
  updateGitRepo: ({contentDir, repos, repoInclude = [], extInclude}, cb) => Promise.resolve()
    .then(() => {
      logger.enabledLevels.trace && log.trace('checking git repos : ', repos)
      repos = repos && (Array.isArray(repos) ? repos : [repos]) || []
      const quietOpt = logger.isEnabled('debug') ? '' : '--quiet'
      return Promise.each(repos, repo => {
        const repoDir = path.join(contentDir, repo.name)
        return fs.statAsync(repoDir)
          .then(stat => {
            if (stat.isDirectory()) {
              logger.enabledLevels.info && log.info(`updating repo "${repo.name}"...`)
              return helper.executeCmd(`git pull ${quietOpt}`, {cwd: repoDir})
            } else {
              throw new Error(`${repoDir} exists and is not a directory!`)
            }
          })
          .catch(err => {
            if (err.code !== 'ENOENT') {
              throw err
            }
            const cloneUrl = repo.ssh || repo.url
            logger.enabledLevels.info && log.info(`cloning repo "${repo.name}"...`)
            const includeGit = []
              .concat(
                repo.baseDir ?
                  `${repo.baseDir}/${repoInclude}` :
                  repoInclude,
                repo.baseDir ?
                  extInclude.map(ext => `${repo.baseDir}/**/*.${ext}`) :
                  extInclude.map(ext => `**/*.${ext}`)
              )
              .join('\n')
            if (includeGit) {
              return helper.executeCmd(`git init ${repo.name} ${quietOpt}`, {cwd: contentDir})
                .then(() => {
                  const gitOpts = {cwd: path.join(contentDir, repo.name)}
                  return helper.executeCmd(`git config core.sparseCheckout true ${quietOpt}`, gitOpts)
                    .then(() => helper.executeCmd(`echo "${includeGit}" > .git/info/sparse-checkout`, gitOpts))
                    .then(() => helper.executeCmd(`git remote add origin ${cloneUrl}`, gitOpts))
                    .then(() => helper.executeCmd(`git fetch ${quietOpt}`, gitOpts))
                    .then(() => helper.executeCmd(`git checkout ${repo.branch || 'master'} ${quietOpt}`, gitOpts))
                })
            } else {
              return helper.executeCmd(`git clone ${cloneUrl} ${repo.name} ${quietOpt}`, {cwd: contentDir})
            }
          })
      })
    })
    .asCallback(cb),
  scanMdFiles: ({baseDir, dir, filterDir, includeDir, excludeDir, filter, include, exclude}, cb) => Promise
    .resolve()
    .then(() => {
      dir = dir ? path.join(baseDir, dir) : baseDir
      logger.enabledLevels.debug && log.debug(`scanning markdown files from : ${dir}`)
      const relDir = path.relative(baseDir, dir)
      return fs.readdirAsync(dir)
        .then(files => {
          if (typeof filterDir === 'function') {
            files = files.filter(filterDir)
          } else {
            if (includeDir) {
              includeDir = new RegExp(includeDir)
              files = files.filter(file => includeDir.test(file))
            }
            if (excludeDir) {
              excludeDir = new RegExp(excludeDir)
              files = files.filter(file => !excludeDir.test(file))
            }
          }
          return files
        })
        .reduce((found, file) => fs.statAsync(path.join(dir, file))
          .then(stats => {
            if (stats.isDirectory()) {
              return helper
                .scanMdFiles({
                  baseDir, filterDir, includeDir, excludeDir, filter, include, exclude,
                  dir: path.join(relDir, file)
                })
                .then(childs => found.concat(childs || []))
            }
            if (typeof filter === 'function') {
              if (!filter(file)) {
                return found
              }
            } else {
              if (include) {
                if (!include.test(file)) {
                  return found
                }
              }
              if (exclude) {
                if (exclude.test(file)) {
                  return found
                }
              }
            }
            file = path.join(relDir, file)
            logger.enabledLevels.trace && log.trace(`found file : ${file}`)
            return found.concat(file)
          }), [])
    })
    .asCallback(cb),
  findRepo: (repoName, repos) => repoName && _.find(repos, {name: repoName}),
  withoutExt: file => file.slice(0, -path.extname(file).length),
  getRepoName: file => _.first(file.split('/')),
  toId: text => _
    .compact(accents
      .reduce((text, accent) => text.replace(accent.from, accent.to), text)
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .split('-')
    ).join('-'),
  buildBreadcrumb: uri => _.compact(_.tail(uri.split('/')))
    .map((item, index, ar) => ({
      title: item,
      url: ar.slice(0, index + 1).join('/')
    }))
}

exports = module.exports = helper
