/* eslint no-console:0 */

'use strict';

const util = require('util');
const fs = require('fs');
const simpleParser = require('../lib/simple-parser.js');

let input = fs.createReadStream(process.argv[2] || __dirname + '/simple.eml');

simpleParser(input)
    .then(mail => {
        console.log(util.inspect(mail, false, 22));
    })
    .catch(err => {
        console.log(err);
    });
