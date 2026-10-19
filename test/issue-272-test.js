'use strict';

const { test } = require('node:test');

const simpleParser = require('..').simpleParser;

test('Throws TypeError with input === null', async t => {
    try {
        simpleParser(null);

        throw Error('Error not thrown.');
    } catch (error) {
        t.assert.strictEqual(error.constructor.name, 'TypeError');
    }
});

test('Throws TypeError with input === undefined', async t => {
    try {
        simpleParser(undefined);

        throw Error('Error not thrown.');
    } catch (error) {
        t.assert.strictEqual(error.constructor.name, 'TypeError');
    }
});

test('Throws TypeError without input', async t => {
    try {
        simpleParser();

        throw Error('Error not thrown.');
    } catch (error) {
        t.assert.strictEqual(error.constructor.name, 'TypeError');
    }
});
