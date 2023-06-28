'use strict';

const simpleParser = require('..').simpleParser;

module.exports['Hangs when Reply-To invalid encoded'] = async test => {
    await simpleParser('Content-type: text/plain\r\nReply-To: =?U� -8?B?0=D0=BA=D0=BE=D0=B2?=\n\r\n1234');
    test.done();
};
