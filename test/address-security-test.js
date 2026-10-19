'use strict';

const { test } = require('node:test');

const simpleParser = require('../lib/simple-parser');

test('Should not fabricate address from bare Base64 encoded email', (t, done) => {
    // attacker@evil.com encoded as Base64
    let source = Buffer.from(`From: =?utf-8?b?YXR0YWNrZXJAZXZpbC5jb20=?=\r\nTo: victim@example.com\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        t.assert.strictEqual(mail.from.value[0].address, '', 'Bare encoded email must not become an address');
        t.assert.strictEqual(mail.from.value[0].name, 'attacker@evil.com', 'Decoded text should be treated as display name');

        done();
    });
});

test('Should keep an encoded Name <email> as the display name', (t, done) => {
    // "Rydel" <Rydelkalot@17guagua.com> encoded as Base64. The header carries no address,
    // so the decoded text is a name only, as other clients show it
    let source = Buffer.from(`From: test@example.com\r\nTo: =?utf-8?B?IlJ5ZGVsIiA8UnlkZWxrYWxvdEAxN2d1YWd1YS5jb20+?=, andris@tr.ee\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        t.assert.deepStrictEqual(mail.to.value, [
            { address: '', name: '"Rydel" <Rydelkalot@17guagua.com>' },
            { address: 'andris@tr.ee', name: '' }
        ]);
        t.assert.ok(!mail.to.value.some(a => a.address === 'Rydelkalot@17guagua.com'), 'Decoded text must not become an address');

        done();
    });
});

test('Should not turn an encoded bracketed display name into an address', (t, done) => {
    // "CEO" <ceo@bank.com> encoded as Base64 in Sender and From
    let source = Buffer.from(
        `Sender: =?utf-8?B?IkNFTyIgPGNlb0BiYW5rLmNvbT4=?=\r\nFrom: =?utf-8?B?IkNFTyIgPGNlb0BiYW5rLmNvbT4=?=\r\nTo: victim@example.com\r\n\r\ntest`
    );

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        for (let header of [mail.headers.get('sender'), mail.from]) {
            t.assert.strictEqual(header.value.length, 1);
            t.assert.strictEqual(header.value[0].address, '', 'The raw header carries no address, so none may be reported');
            t.assert.strictEqual(header.value[0].name, '"CEO" <ceo@bank.com>');
        }
        t.assert.strictEqual(mail.from.text, '"\\"CEO\\" <ceo@bank.com>"');

        done();
    });
});

test('Should escape quotes and backslashes in display names of the text rendering', (t, done) => {
    let source = Buffer.from(`From: "Jane \\"JD\\" Doe" <jane@example.com>\r\nTo: "Back\\\\slash" <b@example.com>, plain@example.com\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        t.assert.strictEqual(mail.from.value[0].name, 'Jane "JD" Doe');
        t.assert.strictEqual(mail.from.text, '"Jane \\"JD\\" Doe" <jane@example.com>');
        t.assert.strictEqual(mail.to.text, '"Back\\\\slash" <b@example.com>, plain@example.com');

        done();
    });
});

test('Should decode and reject encoded-words in addr-spec that produce invalid addresses', (t, done) => {
    // =40 decodes to @, producing @attacker.com@microsoft.com (two @ signs)
    let source = Buffer.from(`From: =?utf-8?q?=40attacker.com?=@microsoft.com\r\nTo: victim@example.com\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        t.assert.strictEqual(mail.from.value[0].address, '', 'Encoded-word in addr-spec producing invalid address should be cleared');

        done();
    });
});

test('Should not touch normal addresses', (t, done) => {
    let source = Buffer.from(`From: "Sender" <sender@example.com>\r\nTo: recipient@example.com\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        t.assert.strictEqual(mail.from.value[0].address, 'sender@example.com');
        t.assert.strictEqual(mail.from.value[0].name, 'Sender');
        t.assert.strictEqual(mail.to.value[0].address, 'recipient@example.com');

        done();
    });
});

test('Should not touch percent-hack addresses', (t, done) => {
    let source = Buffer.from(`From: user%attacker.com@microsoft.com\r\nTo: victim@example.com\r\n\r\ntest`);

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        t.assert.strictEqual(mail.from.value[0].address, 'user%attacker.com@microsoft.com', 'Percent-hack addresses should pass through as-is');

        done();
    });
});
