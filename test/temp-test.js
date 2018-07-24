'use strict';

const MailParser = require('..').MailParser;
/*
exports['Binary attachment encodings'] = {
    Base64: test => {
        console.log('========');
        let encodedText = 'Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\nAAECA/3+/w==',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            console.log(data.type);
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    console.log('attachment end');
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            console.log('parser end');
            test.equal(Array.prototype.slice.apply((attachments[0].content && attachments[0].content) || []).join(','), '0,1,2,3,253,254,255');
            console.log('========');
            setTimeout(() => test.done(), 1000);
        });
    }
};
*/

exports['Transfer encoding'] = {
    'Base64 Default charset': test => {
        let encodedText = 'Content-type: text/plain\r\nContent-Transfer-Encoding: bAse64\r\n\r\n1cTW3A==',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    }
    /*,
    'Base64 UTF-8': test => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: bAse64\r\n\r\nw5XDhMOWw5w=',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    }
    */
};
