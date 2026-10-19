'use strict';

const { test } = require('node:test');

const fs = require('fs');
const simpleParser = require('..').simpleParser;

test('Parses message/delivery-status', async t => {
    let encodedText = fs.readFileSync(__dirname + '/fixtures/delivery-status.eml');
    let mail = Buffer.from(encodedText, 'utf-8');
    let parsed = await simpleParser(mail);
    t.assert.ok(parsed.text.indexOf('Status: 5.1.1') >= 0);
});
