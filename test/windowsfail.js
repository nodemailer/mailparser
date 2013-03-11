var MailParser = require("../lib/mailparser").MailParser,
    testCase = require('nodeunit').testCase,
    utillib = require("util"),
    encodinglib = require("encoding");

// This test fails in windows as iconv-lite does not support CP949
exports["ks_c_5601-1987"] = function(test){
    var encodedText = "Subject: =?ks_c_5601-1987?B?vcU=?=\r\n"+
                      "Content-Type: text/plain; charset=ks_c_5601-1987\r\n"+
                      "Content-Transfer-Encoding: base64\r\n"+
                      "\r\n"+
                      "vcU=",
        mail = new Buffer(encodedText, "utf-8");

    var mailparser = new MailParser();
    mailparser.end(mail);
    mailparser.on("end", function(mail){
        test.equal(mail.subject, "신");
        test.equal(mail.text.trim(), "신");
        test.done();
    });
};