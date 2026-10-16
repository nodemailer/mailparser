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

module.exports['Should keep an encoded Name <email> as the display name'] = test => {
    // "Rydel" <Rydelkalot@17guagua.com> encoded as Base64. The header carries no address,
    // so the decoded text is a name only, as other clients show it
    let source = Buffer.from(`From: test@example.com\r\nTo: =?utf-8?B?IlJ5ZGVsIiA8UnlkZWxrYWxvdEAxN2d1YWd1YS5jb20+?=, andris@tr.ee\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        test.ifError(err);
        test.ok(mail);

        test.deepEqual(mail.to.value, [
            { address: '', name: '"Rydel" <Rydelkalot@17guagua.com>' },
            { address: 'andris@tr.ee', name: '' }
        ]);
        test.ok(!mail.to.value.some(a => a.address === 'Rydelkalot@17guagua.com'), 'Decoded text must not become an address');

        test.done();
    });
};

module.exports['Should not turn an encoded bracketed display name into an address'] = test => {
    // "CEO" <ceo@bank.com> encoded as Base64 in Sender and From
    let source = Buffer.from(
        `Sender: =?utf-8?B?IkNFTyIgPGNlb0BiYW5rLmNvbT4=?=\r\nFrom: =?utf-8?B?IkNFTyIgPGNlb0BiYW5rLmNvbT4=?=\r\nTo: victim@example.com\r\n\r\ntest`
    );

    simpleParser(source, {}, (err, mail) => {
        test.ifError(err);
        test.ok(mail);

        for (let header of [mail.headers.get('sender'), mail.from]) {
            test.equal(header.value.length, 1);
            test.equal(header.value[0].address, '', 'The raw header carries no address, so none may be reported');
            test.equal(header.value[0].name, '"CEO" <ceo@bank.com>');
        }
        test.equal(mail.from.text, '"\\"CEO\\" <ceo@bank.com>"');

        test.done();
    });
};

module.exports['Should escape quotes and backslashes in display names of the text rendering'] = test => {
    let source = Buffer.from(`From: "Jane \\"JD\\" Doe" <jane@example.com>\r\nTo: "Back\\\\slash" <b@example.com>, plain@example.com\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        test.ifError(err);
        test.ok(mail);

        test.equal(mail.from.value[0].name, 'Jane "JD" Doe');
        test.equal(mail.from.text, '"Jane \\"JD\\" Doe" <jane@example.com>');
        test.equal(mail.to.text, '"Back\\\\slash" <b@example.com>, plain@example.com');

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
