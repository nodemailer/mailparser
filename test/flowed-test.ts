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

test('format=flowed is unfolded in a text/plain part only', (t: TestContext, done) => {
    // RFC 3676 defines it for text/plain, and a browser never unfolds an html part, so
    // `<scri \r\npt>` is no tag to it or to Python. Unfolded here under delsp=yes it became one
    let body = '<scri \r\npt>alert(1)</scri \r\npt>\r\n';
    simpleParser(`Content-Type: text/html; format=flowed; delsp=yes\r\n\r\n${body}`, (err, mail: any) => {
        t.assert.ifError(err);
        t.assert.strictEqual(mail.html, body.replace(/\r\n/g, '\n'));
        simpleParser(`Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\n${body}`, (err, mail: any) => {
            t.assert.ifError(err);
            t.assert.strictEqual(mail.text, '<script>alert(1)</script>');
            done();
        });
    });
});
