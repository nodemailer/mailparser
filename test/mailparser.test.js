var mailparser = require("../mailparser");
var assert = require("assert");

module.exports = {
    "test analyze message ID with =" : function() {
        var parser = new mailparser.MailParser();
        var headers = {};
        var headerObj = { "message-id" : "<CAA11=pqx7aUYoAZmANiRJZE92JRJHJh6xjxWupjzpOu6Wgh=kQ@mail.gmail.com>" };
        parser.analyzeHeaders(headerObj, headers);
        assert.equal(headers.messageId, "CAA11=pqx7aUYoAZmANiRJZE92JRJHJh6xjxWupjzpOu6Wgh=kQ@mail.gmail.com");
    },

}

