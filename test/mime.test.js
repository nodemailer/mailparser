var mime = require("../mime");
var assert = require("assert");

module.exports = {
    "test simple address" : function() {
        assert.deepEqual(mime.parseAddresses("vasya@example.com"),
                [ { address: "vasya@example.com", name: false } ]);
    },
    "test bracketed address" : function() {
        assert.deepEqual(mime.parseAddresses("<vasya@example.com>"),
                [ { address: "vasya@example.com", name: false } ]);
    },
    "test bracketed address 2" : function() {
        assert.deepEqual(mime.parseAddresses("< vasya@example.com >"),
                [ { address: "vasya@example.com", name: false } ]);
    },
    "test bracketed address with name" : function() {
        assert.deepEqual(mime.parseAddresses("Vasya Pupkin <vasya@example.com>"),
                [ { address: "vasya@example.com", name: "Vasya Pupkin" } ]);
    },
    "test bracketed address with name 2" : function() {
        assert.deepEqual(mime.parseAddresses("\"Vasya Pupkin \"< vasya@example.com >"),
                [ { address: "vasya@example.com", name: "Vasya Pupkin" } ]);
    },
    "test bracketed address with comma in name" : function() {
        assert.deepEqual(mime.parseAddresses("\"Pupkin, Vasya\"< vasya@example.com >"),
                [ { address: "vasya@example.com", name: "Pupkin, Vasya" } ]);
    },
    "test muliple addresses" : function() {
        assert.deepEqual(mime.parseAddresses("foo@example.com, Vasya Pupkin <vasya2@example.com>, \"Pupkin, Vasya\"< vasya@example.com >, <pupkin@example.com >,"),
                [ { address: "foo@example.com", name: false },
                  { address: "vasya2@example.com", name: "Vasya Pupkin" },
                  { address: "vasya@example.com", name: "Pupkin, Vasya" },
                  { address: "pupkin@example.com", name: false }
                ]);
    },
    "test decode mime word with charset GB2312": function() {
	assert.equal(mime.decodeMimeWord("=?GB2312?Q?Test_for_=D6=D0=CE=C4?="), "Test for 中文");
    },
    "test decode mime word with charset ISO-2022-JP and Base64": function() {
	assert.equal(mime.decodeMimeWord("=?ISO-2022-JP?B?GyRCJEskWyRzJDQbKEI=?="), "にほんご");
    },
    "test decode quoted printable": function() {
	assert.equal(mime.decodeQuotedPrintable("Test for chinese\n=E4=BA=BA =\n=E6=B0=91", false), "Test for chinese\n人 民");
    }
}
