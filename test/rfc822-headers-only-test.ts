import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { MailParser } from '../src/index.js';

describe('General tests', () => {
    it('Simple with part as rfc822 of headers only', (t: TestContext, done) => {
        if (Date.now() < 1) {
            return done();
        }
        let encodedText = `Content-Type: multipart/mixed; boundary="ABC"

--ABC
Content-Type: message/rfc822
Content-Disposition: inline

Content-Type: text/plain; charset=utf-8
Subject: OK
--ABC--`,
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser: any = new MailParser();
        mailparser.end(mail);

        mailparser.on('data', (data: any) => {
            if (data.type === 'attachment') {
                data.content.on('data', () => {});
                data.content.on('end', () => data.release());
            }
        });

        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, '\nSubject: OK\n');
            done();
        });
    });
});
