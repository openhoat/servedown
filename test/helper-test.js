'use strict';

const chai = require('chai');
const expect = chai.expect;
//const logger = require('hw-logger');
//const log = logger.log;
const helper = require('../lib/helper');

describe('helper', () => {

  it('should convert to id', () => {
    const id = helper.toId('Any title with (special characters) $ * "and accéèentsçàôù" :');
    expect(id).to.equal('any-title-with-special-characters-and-acceeentscaou');
  });

});
