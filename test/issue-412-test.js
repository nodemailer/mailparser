'use strict';

const { describe, it } = require('node:test');

const MailParser = require('..').MailParser;
const simpleParser = require('..').simpleParser;

describe('XSS via URL with quotes in href attribute', () => {
    it('should escape double quotes in URLs', (t, done) => {
        const maliciousEmail = `From: attacker@evil.com
To: victim@example.com
Subject: Test
Content-Type: text/plain

Visit: http://example.com?"onmouseover="alert('XSS')"
`;

        const mailparser = new MailParser();
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            // The generated HTML should not contain unescaped quotes that break out of href
            t.assert.ok(!mailparser.textAsHtml.includes('"onmouseover='), 'Should not contain unescaped event handler');
            t.assert.ok(mailparser.textAsHtml.includes('&quot;'), 'Should contain escaped quotes');
            done();
        });
        mailparser.end(Buffer.from(maliciousEmail));
    });

    it('should escape HTML entities in link text', (t, done) => {
        const maliciousEmail = `From: test@example.com
To: user@example.com
Subject: Test
Content-Type: text/plain

Check: http://example.com/<script>alert(1)</script>
`;

        const mailparser = new MailParser();
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            // Link text should have HTML entities escaped
            t.assert.ok(!mailparser.textAsHtml.includes('<script>'), 'Should not contain unescaped script tag');
            t.assert.ok(mailparser.textAsHtml.includes('&lt;script&gt;'), 'Should contain escaped script tag');
            done();
        });
        mailparser.end(Buffer.from(maliciousEmail));
    });

    it('should handle URL with single quotes', (t, done) => {
        const email = `From: test@example.com
To: user@example.com
Subject: Test
Content-Type: text/plain

Visit: http://example.com?foo='bar'
`;

        const mailparser = new MailParser();
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            // Single quotes in href should be escaped in link text
            t.assert.ok(mailparser.textAsHtml.includes('&apos;') || mailparser.textAsHtml.includes("'"), 'Should handle single quotes');
            t.assert.ok(mailparser.textAsHtml.includes('href="http://example.com'), 'Should contain valid href');
            done();
        });
        mailparser.end(Buffer.from(email));
    });

    it('should work with simpleParser', async t => {
        const maliciousEmail = `From: attacker@evil.com
To: victim@example.com
Subject: Test
Content-Type: text/plain

Visit: http://example.com?"onclick="alert('XSS')"
`;

        const parsed = await simpleParser(maliciousEmail);
        t.assert.ok(!parsed.textAsHtml.includes('"onclick='), 'Should not contain unescaped event handler via simpleParser');
    });

    it('should preserve valid URLs', (t, done) => {
        const email = `From: test@example.com
To: user@example.com
Subject: Test
Content-Type: text/plain

Visit: https://example.com/path?query=value&other=123
`;

        const mailparser = new MailParser();
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.ok(mailparser.textAsHtml.includes('href="https://example.com/path?query=value'), 'Should preserve valid URL');
            done();
        });
        mailparser.end(Buffer.from(email));
    });
});
