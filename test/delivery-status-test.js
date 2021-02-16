'use strict';

const fs = require('fs');
const simpleParser = require('..').simpleParser;

module.exports['Parses message/delivery-status'] = async test => {

  let encodedText = fs.readFileSync(__dirname + '/fixtures/delivery-status.eml');
  let mail = Buffer.from(encodedText, 'utf-8');
  let parsed = await simpleParser(mail);
  test.ok(parsed.text.indexOf('Status: 5.1.1') >= 0);
  test.ok(parsed.html.indexOf('Status: 5.1.1') >= 0);
  test.done();

};
