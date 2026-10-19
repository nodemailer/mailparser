'use strict';

const { test } = require('node:test');

const simpleParser = require('..').simpleParser;

test('Quoted printable, DelSp', (t, done) => {
    let encodedText = 'Content-Type: text/plain; format=flowed; delsp=yes\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\nFoo =\n\nBar =\n\nBaz';
    let mail = Buffer.from(encodedText, 'utf-8');

    simpleParser(mail, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);
        t.assert.strictEqual(mail.text, 'FooBarBaz');
        done();
    });
});
