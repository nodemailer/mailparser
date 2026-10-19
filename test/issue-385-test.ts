import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { simpleParser } from '../src/index.js';

describe('Issue 385', () => {
    it('should not include false for empty References header', (t: TestContext, done) => {
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

        simpleParser(raw, (err, mail: any) => {
            t.assert.ifError(err);
            t.assert.strictEqual(mail.references, '<some.message.id@example.com>');
            done();
        });
    });
});
