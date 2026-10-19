import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { simpleParser } from '../src/index.js';

test('Quoted printable, DelSp', (t: TestContext, done) => {
    let encodedText = 'Content-Type: text/plain; format=flowed; delsp=yes\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\nFoo =\n\nBar =\n\nBaz';
    let mail = Buffer.from(encodedText, 'utf-8');

    simpleParser(mail, (err, mail: any) => {
        t.assert.ifError(err);
        t.assert.ok(mail);
        t.assert.strictEqual(mail.text, 'FooBarBaz');
        done();
    });
});
