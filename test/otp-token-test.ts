import { test } from 'node:test';
import type { TestContext } from 'node:test';
import nodemailer from 'nodemailer';
import { MailParser, simpleParser } from '../src/index.js';
import { getOtp, isOtpOrigin, parseStringItem } from '../src/otp-token.js';

// OTP-Token header, draft-goto-otp-token-01

const message = (...headers: string[]) => [...headers, 'Subject: Code', '', 'Your code is 123456', ''].join('\r\n');

const EXAMPLE = { code: '123456', origin: 'https://example.com' };

const otpOf = async (...headers: string[]) => (await simpleParser(message(...headers))).otp;

test('reads the passcode and origin of the OTP-Token header', async (t: TestContext) => {
    t.assert.deepStrictEqual(await otpOf('OTP-Token: "123456"; origin="https://example.com"'), EXAMPLE);
});

test('reads the header nodemailer sets with its otp option', async (t: TestContext) => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await transport.sendMail({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Code',
        text: 'Your code is 12 "34',
        otp: { code: '12 "34', origin: 'https://Example.com/login' }
    });
    const mail = await simpleParser(info.message as Buffer);
    t.assert.deepStrictEqual(mail.otp, { code: '12 "34', origin: 'https://example.com' });
});

test('keeps the raw header value in headers', async (t: TestContext) => {
    const mail = await simpleParser(message('OTP-Token: "123456"; origin="https://example.com"'));
    t.assert.strictEqual(mail.headers.get('otp-token'), '"123456"; origin="https://example.com"');
});

test('sets otp on the MailParser instance', (t: TestContext, done) => {
    t.plan(1);
    const parser = new MailParser();
    parser.on('headers', () => {
        t.assert.deepStrictEqual(parser.otp, EXAMPLE);
    });
    parser.on('data', data => {
        if (data.type === 'attachment') {
            data.release?.();
        }
    });
    parser.on('end', done);
    parser.end(Buffer.from(message('OTP-Token: "123456"; origin="https://example.com"')));
});

test('reads the header after an mbox From line', async (t: TestContext) => {
    t.assert.deepStrictEqual(await otpOf('From sender@example.com Thu Oct 29 08:00:00 2026', 'OTP-Token: "123456"; origin="https://example.com"'), EXAMPLE);
});

test('matches the header name in any case', async (t: TestContext) => {
    t.assert.deepStrictEqual(await otpOf('otp-TOKEN: "123456"; origin="https://example.com"'), EXAMPLE);
});

test('leaves otp unset without an OTP-Token header', async (t: TestContext) => {
    const mail = await simpleParser(message());
    t.assert.strictEqual(mail.otp, undefined);
    t.assert.ok(!('otp' in mail));
});

test('ignores the header when it appears more than once', async (t: TestContext) => {
    t.assert.strictEqual(await otpOf('OTP-Token: "123456"; origin="https://example.com"', 'OTP-Token: "654321"; origin="https://example.com"'), undefined);
});

test('ignores an OTP-Token header of a MIME part', async (t: TestContext) => {
    const mail = await simpleParser(
        [
            'Content-Type: multipart/mixed; boundary=AAA',
            '',
            '--AAA',
            'Content-Type: text/plain',
            'OTP-Token: "123456"; origin="https://example.com"',
            '',
            'Your code is 123456',
            '--AAA--',
            ''
        ].join('\r\n')
    );
    t.assert.strictEqual(mail.otp, undefined);
});

test('ignores the header of a forwarded message', async (t: TestContext) => {
    const messages = [
        ['Content-Type: message/rfc822', '', 'OTP-Token: "123456"; origin="https://example.com"', 'Subject: Code', '', 'Your code is 123456', ''],
        [
            'Content-Type: multipart/mixed; boundary=AAA',
            '',
            '--AAA',
            'Content-Type: message/rfc822',
            '',
            'OTP-Token: "123456"; origin="https://example.com"',
            'Subject: Code',
            '',
            'Your code is 123456',
            '--AAA--',
            ''
        ]
    ];
    for (const mail of await Promise.all(messages.map(raw => simpleParser(raw.join('\r\n'))))) {
        t.assert.strictEqual(mail.otp, undefined);
    }
});

test('does not count a header with whitespace before the colon', async (t: TestContext) => {
    t.assert.strictEqual(await otpOf('OTP-Token : "123456"; origin="https://example.com"'), undefined);
});

test('reads a folded header', async (t: TestContext) => {
    t.assert.deepStrictEqual(await otpOf('OTP-Token: "123456";\r\n origin="https://example.com"'), EXAMPLE);
    t.assert.deepStrictEqual(await otpOf('OTP-Token:\r\n "123456"; origin="https://example.com"'), EXAMPLE);
    // unfolding keeps the whitespace of the continuation line, and RFC 9651 only allows SP after the semicolon
    t.assert.strictEqual(await otpOf('OTP-Token: "123456";\r\n\torigin="https://example.com"'), undefined);
    t.assert.deepStrictEqual(await otpOf('OTP-Token: "12 34\r\n 56"; origin="https://example.com"'), {
        code: '12 34 56',
        origin: 'https://example.com'
    });
});

test('unescapes the passcode', async (t: TestContext) => {
    t.assert.deepStrictEqual(await otpOf('OTP-Token: "a\\"b\\\\c d"; origin="https://example.com"'), {
        code: 'a"b\\c d',
        origin: 'https://example.com'
    });
});

test('ignores unknown parameters of any type', async (t: TestContext) => {
    t.assert.deepStrictEqual(
        await otpOf(
            'OTP-Token: "123456"; token=:NjU0MzIx:; ttl=600; ratio=1.5; flag; on=?1; at=@1700000000; mode=fast/x; label=%"caf%c3%a9"; origin="https://example.com"'
        ),
        EXAMPLE
    );
});

test('the last origin parameter wins', async (t: TestContext) => {
    t.assert.deepStrictEqual(await otpOf('OTP-Token: "123456"; origin="https://a.example"; origin="https://b.example"'), {
        code: '123456',
        origin: 'https://b.example'
    });
});

test('rejects invalid header values', async (t: TestContext) => {
    const values = [
        '',
        '123456; origin="https://example.com"',
        'abc; origin="https://example.com"',
        '"123456"',
        '"123456"; origin=https',
        '"123456"; origin',
        '"123456"; origin=:aHR0cHM6Ly9leGFtcGxlLmNvbQ==:',
        '"123456" ; origin="https://example.com"',
        '"123456"; Origin="https://example.com"',
        '"123456"; origin="https://example.com" x',
        '"123456"; origin="https://example.com",',
        '"123456", "654321"; origin="https://example.com"',
        '"12345\\6"; origin="https://example.com"',
        '"123456; origin="https://example.com"',
        '"123456"; origin="https://example.com"; ttl=1.',
        '"123456"; origin="https://example.com"; ttl=1.2345',
        '"123456"; origin="https://example.com"; ttl=1234567890123456',
        '"123456"; origin="https://example.com"; at=@1.5',
        '"123456"; origin="https://example.com"; on=?2',
        '"123456"; origin="https://example.com"; label=%"caf%C3%A9"',
        '"123456"; origin="https://example.com"; label=%"%ff"',
        '"123456"; origin="http://example.com"',
        '=?utf-8?Q?=22123456=22?=; origin="https://example.com"'
    ];
    const results = await Promise.all(values.map(value => otpOf('OTP-Token: ' + value)));
    results.forEach((otp, i) => t.assert.strictEqual(otp, undefined, values[i]));
});

test('rejects a passcode with non-ASCII characters', async (t: TestContext) => {
    t.assert.strictEqual(await otpOf('OTP-Token: "12345é"; origin="https://example.com"'), undefined);
    t.assert.strictEqual(await otpOf('OTP-Token: "123456"; origin="https://example.com" '), undefined);
});

test('rejects an empty passcode', async (t: TestContext) => {
    t.assert.strictEqual(await otpOf('OTP-Token: ""; origin="https://example.com"'), undefined);
});

test('ignores a header longer than 8 KiB', (t: TestContext) => {
    const code = 'x'.repeat(8192 - '""; origin="https://example.com"'.length);
    const lines = (value: string) => [{ key: 'otp-token', line: 'OTP-Token: ' + value + ' \t' }];
    t.assert.deepStrictEqual(getOtp(lines(`"${code}"; origin="https://example.com"`)), { code, origin: 'https://example.com' });
    t.assert.strictEqual(getOtp(lines(`"${code}x"; origin="https://example.com"`)), undefined);
});

test('accepts canonical potentially trustworthy origins', (t: TestContext) => {
    for (const origin of [
        'https://example.com',
        'https://sub.example.com:8443',
        'https://xn--bcher-kva.example',
        'https://192.0.2.1',
        'https://[2001:db8::1]',
        'http://localhost',
        'http://localhost:3000',
        'http://app.localhost',
        'http://127.0.0.1:8080',
        'http://[::1]'
    ]) {
        t.assert.ok(isOtpOrigin(origin), origin);
    }
});

test('rejects non-canonical or untrustworthy origins', (t: TestContext) => {
    for (const origin of [
        '',
        'null',
        'example.com',
        'http://example.com',
        'ftp://example.com',
        'wss://example.com',
        'HTTPS://example.com',
        'https://Example.com',
        'https://example.com/',
        'https://example.com/path',
        'https://example.com:443',
        'http://localhost:80',
        'https://example.com:0443',
        'https://user@example.com',
        'https://bücher.example',
        'https://[2001:DB8::1]',
        'https://[2001:db8:0::1]',
        'https://01.2.3.4',
        'https://example.com:99999',
        'https://exa"mple.com',
        'https://example.com.'
    ]) {
        t.assert.ok(!isOtpOrigin(origin), origin);
    }
});

test('parseStringItem reads parameters', (t: TestContext) => {
    const item = parseStringItem('"x";  a="1";b;c=2');
    t.assert.ok(item);
    t.assert.strictEqual(item.value, 'x');
    t.assert.deepStrictEqual(
        [...item.params.entries()],
        [
            ['a', '1'],
            ['b', true],
            ['c', true]
        ]
    );
});
