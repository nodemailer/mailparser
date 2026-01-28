'use strict';

const MailParser = require('..').MailParser;
const simpleParser = require('..').simpleParser;

module.exports['XSS via URL with quotes in href attribute'] = {
    'should escape double quotes in URLs': test => {
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
            test.ok(!mailparser.textAsHtml.includes('"onmouseover='), 'Should not contain unescaped event handler');
            test.ok(mailparser.textAsHtml.includes('&quot;'), 'Should contain escaped quotes');
            test.done();
        });
        mailparser.end(Buffer.from(maliciousEmail));
    },

    'should escape HTML entities in link text': test => {
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
            test.ok(!mailparser.textAsHtml.includes('<script>'), 'Should not contain unescaped script tag');
            test.ok(mailparser.textAsHtml.includes('&lt;script&gt;'), 'Should contain escaped script tag');
            test.done();
        });
        mailparser.end(Buffer.from(maliciousEmail));
    },

    'should handle URL with single quotes': test => {
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
            test.ok(mailparser.textAsHtml.includes('&apos;') || mailparser.textAsHtml.includes("'"), 'Should handle single quotes');
            test.ok(mailparser.textAsHtml.includes('href="http://example.com'), 'Should contain valid href');
            test.done();
        });
        mailparser.end(Buffer.from(email));
    },

    'should work with simpleParser': async test => {
        const maliciousEmail = `From: attacker@evil.com
To: victim@example.com
Subject: Test
Content-Type: text/plain

Visit: http://example.com?"onclick="alert('XSS')"
`;

        const parsed = await simpleParser(maliciousEmail);
        test.ok(!parsed.textAsHtml.includes('"onclick='), 'Should not contain unescaped event handler via simpleParser');
        test.done();
    },

    'should preserve valid URLs': test => {
        const email = `From: test@example.com
To: user@example.com
Subject: Test
Content-Type: text/plain

Visit: https://example.com/path?query=value&other=123
`;

        const mailparser = new MailParser();
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.ok(mailparser.textAsHtml.includes('href="https://example.com/path?query=value'), 'Should preserve valid URL');
            test.done();
        });
        mailparser.end(Buffer.from(email));
    }
};
