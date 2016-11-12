'use strict';

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
    expect(serverdown).not.to.have.property('initialized');
  });

  it('should init', () => {
    serverdown.init();
    expect(serverdown).to.have.property('initialized', true);
    log.debug('serverdown :', serverdown);
  });

});
