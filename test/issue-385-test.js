'use strict';

const { simpleParser } = require('..');

module.exports['Issue 385'] = {
    'should not include false for empty References header': test => {
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
            test.ifError(err);
            test.equal(mail.references, '<some.message.id@example.com>');
            test.done();
        });
    }
};
