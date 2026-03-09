'use strict';

const simpleParser = require('../lib/simple-parser');

module.exports['Should not fabricate address from bare Base64 encoded email'] = test => {
    // attacker@evil.com encoded as Base64
    let source = Buffer.from(`From: =?utf-8?b?YXR0YWNrZXJAZXZpbC5jb20=?=\r\nTo: victim@example.com\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        test.ifError(err);
        test.ok(mail);

        test.equal(mail.from.value[0].address, '', 'Bare encoded email must not become an address');
        test.equal(mail.from.value[0].name, 'attacker@evil.com', 'Decoded text should be treated as display name');

        test.done();
    });
};

module.exports['Should still parse legitimate encoded Name <email> addresses'] = test => {
    // "Rydel" <Rydelkalot@17guagua.com> encoded as Base64
    let source = Buffer.from(`From: test@example.com\r\nTo: =?utf-8?B?IlJ5ZGVsIiA8UnlkZWxrYWxvdEAxN2d1YWd1YS5jb20+?=, andris@tr.ee\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        test.ifError(err);
        test.ok(mail);

        let toAddresses = mail.to.value;
        let rydel = toAddresses.find(a => a.address === 'Rydelkalot@17guagua.com');
        test.ok(rydel, 'Legitimate encoded address with angle brackets should still be parsed');
        test.equal(rydel.name, 'Rydel');

        test.done();
    });
};

module.exports['Should decode and reject encoded-words in addr-spec that produce invalid addresses'] = test => {
    // =40 decodes to @, producing @attacker.com@microsoft.com (two @ signs)
    let source = Buffer.from(`From: =?utf-8?q?=40attacker.com?=@microsoft.com\r\nTo: victim@example.com\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        test.ifError(err);
        test.ok(mail);

        test.equal(mail.from.value[0].address, '', 'Encoded-word in addr-spec producing invalid address should be cleared');

        test.done();
    });
};

module.exports['Should not touch normal addresses'] = test => {
    let source = Buffer.from(`From: "Sender" <sender@example.com>\r\nTo: recipient@example.com\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        test.ifError(err);
        test.ok(mail);

        test.equal(mail.from.value[0].address, 'sender@example.com');
        test.equal(mail.from.value[0].name, 'Sender');
        test.equal(mail.to.value[0].address, 'recipient@example.com');

        test.done();
    });
};

module.exports['Should not touch percent-hack addresses'] = test => {
    let source = Buffer.from(`From: user%attacker.com@microsoft.com\r\nTo: victim@example.com\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        test.ifError(err);
        test.ok(mail);

        test.equal(mail.from.value[0].address, 'user%attacker.com@microsoft.com', 'Percent-hack addresses should pass through as-is');

        test.done();
    });
};
