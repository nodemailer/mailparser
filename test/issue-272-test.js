'use strict';

const simpleParser = require('..').simpleParser;

module.exports['Throws TypeError with input === null'] = async test => {

  try {
    simpleParser(null);

    throw Error('Error not thrown.');
  } catch (error) {
    test.equal(error.constructor.name, 'TypeError');
  }

  test.done();

};

module.exports['Throws TypeError with input === undefined'] = async test => {

  try {
    simpleParser(undefined);

    throw Error('Error not thrown.');
  } catch (error) {
    test.equal(error.constructor.name, 'TypeError');
  }

  test.done();

};

module.exports['Throws TypeError without input'] = async test => {

  try {
    simpleParser();

    throw Error('Error not thrown.');
  } catch (error) {
    test.equal(error.constructor.name, 'TypeError');
  }

  test.done();

};
