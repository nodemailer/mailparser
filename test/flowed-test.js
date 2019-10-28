'use strict';

const simpleParser = require('..').simpleParser;

module.exports['Quoted printable, DelSp'] = test => {
    let encodedText = 'Content-Type: text/plain; format=flowed; delsp=yes\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\nFoo =\n\nBar =\n\nBaz';
    let mail = Buffer.from(encodedText, 'utf-8');

    simpleParser(mail, (err, mail) => {
        test.ifError(err);
        test.ok(mail);
        test.equal(mail.text, 'FooBarBaz');
        test.done();
    });
};
