/* eslint no-console:0 */

'use strict';

const util = require('util');
const fs = require('fs');
const MailParser = require('../lib/mail-parser.js');

let parser = new MailParser();
let input = fs.createReadStream(__dirname + '/nodemailer.eml');

let attachments = [];

input.pipe(parser);

parser.on('headers', headers => {
    console.log(util.inspect(headers, false, 22));
});

parser.on('data', data => {
    if (data.type === 'text') {
        Object.keys(data).forEach(key => {
            console.log(key);
            console.log('----');
            console.log(data[key]);
        });
    }

    if (data.type === 'attachment') {
        attachments.push(data);
        data.chunks = [];
        data.chunklen = 0;
        let size = 0;
        Object.keys(data).forEach(key => {
            if (typeof data[key] !== 'object' && typeof data[key] !== 'function') {
                console.log('%s: %s', key, JSON.stringify(data[key]));
            }
        });
        data.content.on('readable', () => {
            let chunk;
            while ((chunk = data.content.read()) !== null) {
                size += chunk.length;
                data.chunks.push(chunk);
                data.chunklen += chunk.length;
            }
        });

        data.content.on('end', () => {
            data.buf = Buffer.concat(data.chunks, data.chunklen);
            console.log('%s: %s B', 'size', size);
            // attachment needs to be released before next chunk of
            // message data can be processed
            data.release();
        });
    }
});

parser.on('end', () => {
    console.log('READY');

    parser.updateImageLinks(
        (attachment, done) => done(false, 'data:' + attachment.contentType + ';base64,' + attachment.buf.toString('base64')),
        (err, html) => {
            if (err) {
                console.log(err);
            }
            if (html) {
                console.log(html);
            }
        }
    );
});
