'use strict';

const path = require('path');
const fs = require('fs');
const Promise = require('bluebird');
const chai = require('chai');
const expect = chai.expect;
const logger = require('hw-logger');
const log = logger.log;
const ServeDown = require('../lib/servedown');
const helper = require('../lib/helper');
const srcDir = path.join(__dirname, '..', 'dist', 'test', 'src');
const cacheDir = path.join(__dirname, '..', 'dist', 'test', 'cache');

Promise.promisifyAll(fs);

describe('servedown', () => {

  before(() => {
    logger.setLevel('trace');
  });

  describe('init', () => {

    it('should instantiate a ServerDown instance', () => {
      const servedown = new ServeDown();
      expect(servedown).to.be.ok;
      expect(servedown).to.have.property('config');
      expect(servedown).not.to.have.property('initialized');
    });

    it('should init', () => {
      const servedown = new ServeDown();
      const config = {srcDir, cacheDir, repos: []};
      servedown.init(config);
      expect(servedown).to.have.property('initialized', true);
      expect(servedown).to.have.property('config');
      expect(servedown.config).to.eql(config);
      expect(servedown).to.have.property('locals');
      const locals = servedown.locals;
      expect(locals).to.have.property('config');
      expect(locals.config).to.have.property('srcDir', srcDir);
      expect(locals.config).to.have.property('cacheDir', cacheDir);
    });

  });

  it('should process empty working dir', () => {
    const config = {srcDir: path.join(__dirname, '..', 'dist', 'test', 'tmp'), cacheDir, repos: []};
    const servedown = new ServeDown(config);
    return servedown.process()
      .then(() => {
        expect(servedown).to.have.property('locals');
      });
  });

  describe('markdown content', () => {

    it('sould preprocess content', () => {
      const config = {srcDir, cacheDir, repos: []};
      const servedown = new ServeDown();
      servedown.init(config);
      const src = servedown.preprocessContent(['# Title 1', '',
        '{{{{{{',
        'content',
        '}}}}}}',
        '',
        '# Title 2',
        '## Subtitle',
        ''].join('\n')
      );
      expect(src).to.equal(['# Title 1',
        '',
        '<div class="wsd" wsd_style=""><pre>',
        '',
        '	content',
        '',
        '</pre></div><script src="http://www.websequencediagrams.com/service.js"></script>',
        '',
        '# Title 2',
        '## Subtitle', ''].join('\n')
      );
    });

    it('should render markdown contents', () => {
      const config = {srcDir, cacheDir, repos: []};
      const servedown = new ServeDown();
      servedown.init(config);
      const contentSrcDir = path.join(__dirname, 'src');
      return fs.readdirAsync(contentSrcDir)
        .reduce((result, file) => {
          const match = file.match(/^test-([0-9]+).md$/);
          if (!match) {
            return result;
          }
          const filePath = path.join(contentSrcDir, file);
          return fs.statAsync(filePath)
            .then(stat => {
              if (stat.isDirectory()) {
                return result;
              }
              const index = parseInt(match[1], 10);
              return result.concat({index, file, filePath});
            });
        }, [])
        .then(data => data.sort((i, j) => i.index - j.index))
        .each(({index, file, filePath}) => {
          logger.enabledLevels.info && log.info(`processing test #${index}`);
          return fs.readFileAsync(filePath, 'utf8')
            .then(mdContent => {
              const htmlFilePath = path.join(contentSrcDir, helper.withoutExt(file) + '.html');
              return fs.readFileAsync(htmlFilePath, 'utf8')
                .then(expectedHtmlContent => {
                  const meta = servedown.buildDocHtml(mdContent);
                  expect(meta).to.have.property('htmlContent');
                  expect(meta.htmlContent.split('\n')).to.eql(expectedHtmlContent.split('\n'));
                });
            });
        });
    });

  });

});
