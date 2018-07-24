/* eslint no-console:0 */

'use strict';

const util = require('util');
const fs = require('fs');
const simpleParser = require('../lib/simple-parser.js');

async function main() {
    let mail = await simpleParser(fs.createReadStream(__dirname + '/simple.eml'));
    console.log(util.inspect(mail, false, 22));
}

main().catch(err => {
    console.log(err);
});
