'use strict';

const MailParser = require('..').MailParser;

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
            test.done();
        });
    }
};
