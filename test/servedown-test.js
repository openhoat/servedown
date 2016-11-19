'use strict';

const path = require('path');
const chai = require('chai');
const expect = chai.expect;
const logger = require('hw-logger');
//const log = logger.log;
const ServerDown = require('../lib/servedown');
const srcDir = path.join(__dirname, '..', 'dist', 'test', 'src');
const cacheDir = path.join(__dirname, '..', 'dist', 'test', 'cache');

describe('servedown', () => {

  before(() => {
    logger.setLevel('trace');
  });

  it('should instantiate a ServerDown instance', () => {
    const serverdown = new ServerDown();
    expect(serverdown).to.be.ok;
    expect(serverdown).to.have.property('config');
    expect(serverdown).not.to.have.property('initialized');
  });

  it('should init', () => {
    const serverdown = new ServerDown();
    const config = {srcDir, cacheDir, repos: []};
    serverdown.init(config);
    expect(serverdown).to.have.property('initialized', true);
    expect(serverdown).to.have.property('config');
    expect(serverdown.config).to.eql(config);
    expect(serverdown).to.have.property('locals');
    const locals = serverdown.locals;
    expect(locals).to.have.property('config');
    expect(locals.config).to.have.property('srcDir', srcDir);
    expect(locals.config).to.have.property('cacheDir', cacheDir);
  });

  it('should process empty working dir', () => {
    const config = {srcDir: path.join(__dirname, '..', 'dist', 'test', 'tmp'), cacheDir, repos: []};
    const serverdown = new ServerDown(config);
    return serverdown.process()
      .then(() => {
        expect(serverdown).to.have.property('locals');
      });
  });

  it('sould preprocess content', () => {
    const config = {srcDir, cacheDir, repos: []};
    const serverdown = new ServerDown();
    serverdown.init(config);
    const src = serverdown.preprocessContent(['# Title 1', '',
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

});
