'use strict';

const path = require('path');
const fs = require('fs');
const _ = require('lodash');
const template = require('lodash.template');
const childProcess = require('child_process');
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

const helper = {
  pkg,
  homeDir,
  baseDir,
  updateGitRepo: ({contentDir, repos, repoInclude, markdownExt}) => {
    logger.enabledLevels.trace && log.trace('checking git repos : ', repos);
    const executeCmd = (command, ...opts) => {
      logger.enabledLevels.trace && log.trace(`execute comand "${command}"`);
      const stdout = childProcess.execSync(command, ...opts).toString();
      if (stdout) {
        logger.enabledLevels.debug && log.debug(stdout);
      }
    };
    repos = Array.isArray(repos) ? repos : [repos];
    repos.forEach(repo => {
      const repoDir = path.join(contentDir, repo.name);
      try {
        const stat = fs.statSync(repoDir);
        if (stat.isDirectory()) {
          logger.enabledLevels.info && log.info(`updating repo "${repo.name}"...`);
          executeCmd('git pull --quiet', {cwd: repoDir});
        } else {
          throw new Error(`${repoDir} exists and is not a directory!`);
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
        const cloneUrl = repo.ssh || repo.url;
        logger.enabledLevels.info && log.info(`cloning repo "${repo.name}"...`);
        const includeGit = repoInclude && markdownExt.map(ext => `**/*.${ext}`)
            .concat(repoInclude)
            .join('\n');
        if (includeGit) {
          executeCmd(`git init ${repo.name}`, {cwd: contentDir});
          const gitOpts = {cwd: path.join(contentDir, repo.name)};
          executeCmd('git config core.sparseCheckout true', gitOpts);
          executeCmd(`echo "${includeGit}" > .git/info/sparse-checkout`, gitOpts);
          executeCmd(`git remote add -f origin ${cloneUrl}`, gitOpts);
          executeCmd(`git checkout ${repo.branch || 'master'} --quiet`, gitOpts);
        } else {
          executeCmd(`git clone --quiet ${cloneUrl} ${repo.name}`, {cwd: contentDir});
        }
      }
    });
  },
  scanMdFiles: ({baseDir, dir, filterDir, includeDir, excludeDir, filter, include, exclude}) => {
    dir = dir ? path.join(baseDir, dir) : baseDir;
    logger.enabledLevels.debug && log.debug(`scanning markdown files from : ${dir}`);
    const relDir = path.relative(baseDir, dir);
    let files = fs.readdirSync(dir);
    if (typeof filterDir === 'function') {
      files = files.filter(filterDir);
    } else {
      if (includeDir) {
        includeDir = new RegExp(includeDir);
        files = files.filter(file => includeDir.test(file));
      }
      if (excludeDir) {
        excludeDir = new RegExp(excludeDir);
        files = files.filter(file => !excludeDir.test(file));
      }
    }
    return files.reduce((found, file) => {
      const stats = fs.statSync(path.join(dir, file));
      if (stats.isDirectory()) {
        const childs = helper
          .scanMdFiles({
            baseDir, filterDir, includeDir, excludeDir, filter, include, exclude,
            dir: path.join(relDir, file)
          });
        return found.concat(childs || []);
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
    }, []);
  },
  findRepo: (repoName, repos) => repoName && _.find(repos, {name: repoName}),
  withoutExt: file => file.slice(0, -path.extname(file).length),
  getRepoName: file => _.first(file.split('/')),
  toId: text => _
    .compact(accents
      .reduce((text, accent) => text.replace(accent.from, accent.to), text)
      //.replace(/[':"]/, ' ')
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .split('-')
    ).join('-'),
  buildBreadcrumb: req => _.compact(_.tail(req.path.split('/'))),
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
  }
};

exports = module.exports = helper;
