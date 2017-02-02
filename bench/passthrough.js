'use strict';

const PassThrough = require('stream').PassThrough;
const randomMessage = require('random-message');
const messages = Number(process.env.MESSAGES) || 10000;

const messagesRoot = '/Users/andris/Projects/nodemailer/Gmail/Messages';
let processed = 0;
let startTime = Date.now();
let bytes = 0;

let processNext = () => {
    if (++processed >= messages) {
        let time = (Date.now() - startTime) / 1000;
        let avg = Math.round(processed / time);
        console.log('Done. %s messages [%s MB] processed in %s s. with average of %s messages/sec [%s MB/s]', processed, Math.round(bytes / (1024 * 1024)), time, avg, Math.round((bytes / (1024 * 1024)) / time)); // eslint-disable-line no-console
        return;
    }

    let stream = new PassThrough();

    stream.on('readable', () => {
        let chunk;
        while ((chunk = stream.read()) !== null) {
            bytes += chunk.length;
        }
    });

    stream.on('end', () => {
        stream = false;
        setImmediate(processNext);
    });

    randomMessage.get(messagesRoot, (processed * 0x10000).toString(16)).pipe(stream);
};

console.log('Streaming %s random messages through a plain PassThrough', messages); // eslint-disable-line no-console
processNext();
