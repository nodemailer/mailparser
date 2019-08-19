'use strict';

const MailParser = require('..').MailParser;

exports['General tests'] = {
    'Simple with part as rfc822 of headers only': test => {
        if (Date.now() < 1) {
            return test.done();
        }
        let encodedText = `Content-Type: multipart/mixed; boundary="ABC"

--ABC
Content-Type: message/rfc822

Content-Type: text/plain; charset=utf-8
Subject: OK
--ABC--`,
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, '\nSubject: OK\n');
            test.done();
        });
    }
};
