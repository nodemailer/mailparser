'use strict';

if (process.argv.length < 3) {
    process.stdout.write('USAGE: nodejs emailtojson.js filename');
    process.stdout.write('Example: nodejs emailtojson.js emailfile.eml');
    return;
}

const fs = require('fs');
const MailParser = require('../lib/mail-parser');

const mailpath = process.argv[2];

let parser = new MailParser();
let input = fs.createReadStream(mailpath);
let mailobj = {
    attachments: [],
    text: {}
};

parser.on('headers', headers => {
    let headerObj = {};
    for (let [k, v] of headers) {
        // We don’t escape the key '__proto__'
        // which can cause problems on older engines
        headerObj[k] = v;
    }

    mailobj.headers = headerObj;
});

parser.on('data', data => {
    if (data.type === 'attachment') {
        mailobj.attachments.push(data);
        data.content.on('readable', () => data.content.read());
        data.content.on('end', () => data.release());
    } else {
        mailobj.text = data;
    }
});

parser.on('end', () => {
    process.stdout.write(JSON.stringify(mailobj, (k, v) => (k === 'content' || k === 'release' ? undefined : v), 3));
});
input.pipe(parser);
