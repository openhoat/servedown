'use strict';

const path = require('path');
const chai = require('chai');
const expect = chai.expect;
const logger = require('hw-logger');
const log = logger.log;
const ServerDown = require('../lib/servedown');

describe('servedown', () => {

  let serverdown;

  before(() => {
    logger.setLevel('trace');
  });

  it('should instantiate a ServerDown instance', () => {
    serverdown = new ServerDown();
    expect(serverdown).to.be.ok;
    expect(serverdown).to.have.property('locals');
    expect(serverdown).not.to.have.property('initialized');
  });

  it('should init', () => {
    const config = {
      workingDir: path.join(__dirname, '..', '.working'),
      repos: []
    };
    serverdown.init(config);
    expect(serverdown).to.have.property('initialized', true);
    expect(serverdown).to.have.property('config');
    expect(serverdown.config).to.eql(config);
    expect(serverdown).to.have.property('locals');
    const locals = serverdown.locals;
    expect(locals).to.have.property('config');
    expect(locals.config).to.have.property('workingDir', config.workingDir);
  });

  it('should compute', () => serverdown.compute()
    .then(() => {
      expect(serverdown).to.have.property('locals');
      const locals = serverdown.locals;
      expect(locals).to.have.property('docs');
      expect(locals.docs).to.be.an('object');
    })
  );

});
