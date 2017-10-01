/* eslint no-console: 0 */

'use strict';

const MailParser = require('../index.js').MailParser;
const randomMessage = require('random-message');
const messages = Number(process.env.MESSAGES) || 10000;

const Transform = require('stream').Transform;

const messagesRoot = '/Users/andris/Projects/nodemailer/Gmail/Messages';
let processed = 0;
let startTime = Date.now();
let bytes = 0;

class Counter extends Transform {
    constructor() {
        super();
        this.bytes = 0;
    }
    _transform(chunk, encoding, done) {
        this.bytes += chunk.length;
        done(null, chunk);
    }
    _flush(done) {
        bytes += this.bytes;
        done();
    }
}

let processNext = () => {
    if (++processed >= messages) {
        let time = (Date.now() - startTime) / 1000;
        let avg = Math.round(processed / time);
        console.log(
            'Done. %s messages [%s MB] processed in %s s. with average of %s messages/sec [%s MB/s]',
            processed,
            Math.round(bytes / (1024 * 1024)),
            time,
            avg,
            Math.round(bytes / (1024 * 1024) / time)
        );
        return;
    }

    let parser = new MailParser();
    parser.on('data', data => {
        if (data.type === 'attachment') {
            data.content.on('data', () => false);
            data.content.on('end', () => data.release());
        }
    });

    parser.on('end', () => {
        parser = false;

        setImmediate(processNext);
    });

    parser.on('error', err => {
        console.log(err);
    });

    //randomMessage.get(messagesRoot, (processed * 0x10000).toString(16)).pipe(require('fs').createWriteStream('test.eml'));

    randomMessage
        .get(messagesRoot, (processed * 0x10000).toString(16))
        .pipe(new Counter())
        .pipe(parser);
};

console.log('Streaming %s random messages through MailParser', messages);
processNext();
