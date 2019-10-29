'use strict';

const MailParser = require('..').MailParser;

exports['General tests'] = {
    'Simple with part as rfc822 of headers only': test => {
        if (Date.now() < 1) {
            return test.done();
        }
        let encodedText = `Content-Type: text/plain
References:
    <831872163.433861.2199124418162.JavaMail.otbatch@blabla.bla.bla.com> 
    =?utf-8?q?=3CTY1PR0301MB1149CEFEA528CEA0045533B1FBA70=40TY1PR0301MB1149=2Ea?=
    =?utf-8?q?pcprd03=2Eprod=2Eoutlook=2Ecom=3E?=

Hello world`,
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.deepEqual(mailparser.headers.get('references'), [
                '<831872163.433861.2199124418162.JavaMail.otbatch@blabla.bla.bla.com>',
                '<TY1PR0301MB1149CEFEA528CEA0045533B1FBA70@TY1PR0301MB1149.apcprd03.prod.outlook.com>'
            ]);
            test.done();
        });
    }
};
