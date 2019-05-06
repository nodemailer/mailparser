/* eslint no-console:0 */

'use strict';

const util = require('util');
const fs = require('fs');
const simpleParser = require('../lib/simple-parser.js');

async function main() {
    let mail = await simpleParser(fs.createReadStream(__dirname + '/nodemailer.eml'), {
        skipImageLinks: true, // do not convert CID attachments to data URL images
        skipHtmlToText: false, // generate plaintext from HTML if needed
        skipTextToHtml: false, // generate HTML from plaintext if needed
        skipTextLinks: true, // do not linkify links in plaintext content
        formatDateString: date => date.toUTCString() // format date in RFC822 embedded HTML head section
    });

    console.log(util.inspect(mail, false, 22));
}

main().catch(err => {
    console.log(err);
});
