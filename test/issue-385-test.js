'use strict';

const { describe, it } = require('node:test');

const { simpleParser } = require('..');

describe('Issue 385', () => {
    it('should not include false for empty References header', (t, done) => {
        let raw = [
            'From: sender@example.com',
            'To: recipient@example.com',
            'Subject: Test',
            'References:',
            'References: <some.message.id@example.com>',
            'MIME-Version: 1.0',
            'Content-Type: text/plain',
            '',
            'Test body'
        ].join('\r\n');

        simpleParser(raw, (err, mail) => {
            t.assert.ifError(err);
            t.assert.strictEqual(mail.references, '<some.message.id@example.com>');
            done();
        });
    });
});
