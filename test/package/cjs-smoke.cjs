'use strict';

// CommonJS smoke test for the built package, run by `npm run test:cjs` as plain Node with
// NODE_OPTIONS=--no-experimental-require-module. EmailEngine bundles mailparser into a
// @yao-pkg/pkg binary that can only load a CommonJS module graph, and Node 22+ enables
// require(esm) by default, which would hide an ES module reached through require(). With the
// flag set, such a module throws ERR_REQUIRE_ESM here instead of in the binary. Kept as plain
// JavaScript on purpose: running it through tsx would let its loader transpile an ES module to
// CommonJS and mask exactly the failure this guards against.

const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');

const root = path.resolve(__dirname, '..', '..');
const pkg = require(path.join(root, 'package.json'));
const entry = path.join(root, pkg.exports['.'].require);

const message = [
    'From: =?UTF-8?Q?J=C3=B5geva?= <sender@xn--mnchen-3ya.example>',
    'To: a@example.com, b@example.com',
    'Subject: =?UTF-8?Q?Tere,_maailm?=',
    'Date: Fri, 07 Mar 2014 11:01:40 UTC',
    'Message-ID: <smoke@example.com>',
    'List-Unsubscribe: <mailto:unsubscribe@example.com>',
    'Content-Type: multipart/mixed; boundary=mixed',
    '',
    '--mixed',
    'Content-Type: multipart/related; boundary=rel',
    '',
    '--rel',
    'Content-Type: text/html; charset=iso-8859-1',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<p>Hello see https://example.com <img src=3D"cid:img1"></p>',
    '--rel',
    'Content-Type: image/png',
    'Content-ID: <img1>',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('not really a png').toString('base64'),
    '--rel--',
    '--mixed',
    'Content-Type: text/plain; charset=iso-2022-jp; format=flowed',
    '',
    'Plain text with https://example.com/path ',
    'continued',
    '--mixed',
    'Content-Type: application/octet-stream; name="report.pdf"',
    'Content-Disposition: attachment; filename="report.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('%PDF-1.4 smoke').toString('base64'),
    '--mixed--',
    ''
].join('\r\n');

async function run() {
    const mailparser = require(entry);
    assert.strictEqual(require.resolve('mailparser'), entry);
    assert.deepStrictEqual(Object.keys(mailparser), ['MailParser', 'simpleParser']);
    assert.strictEqual(mailparser.default, mailparser);

    // Every path the exports map publishes, the way deep imports load them
    for (const name of Object.keys(pkg.exports)) {
        if (name !== '.' && name !== './package.json') {
            require('mailparser' + name.slice(1));
        }
    }
    assert.strictEqual(require('mailparser/lib/mail-parser'), mailparser.MailParser);
    assert.strictEqual(require('mailparser/lib/simple-parser.js'), mailparser.simpleParser);
    assert.ok(Object.getPrototypeOf(mailparser.MailParser.prototype) === Transform.prototype);

    // simpleParser, through every runtime dependency: libmime, mailsplit, nodemailer's
    // addressparser, punycode, iconv-lite, encoding-japanese, html-to-text, he, linkify-it and tlds
    const mail = await mailparser.simpleParser(message);
    assert.strictEqual(mail.subject, 'Tere, maailm');
    assert.strictEqual(mail.from.value[0].name, 'Jõgeva');
    assert.strictEqual(mail.from.value[0].address, 'sender@münchen.example');
    assert.strictEqual(mail.to.value.length, 2);
    assert.strictEqual(mail.date.toISOString(), '2014-03-07T11:01:40.000Z');
    assert.strictEqual(mail.messageId, '<smoke@example.com>');
    assert.deepStrictEqual(mail.headers.get('list'), { unsubscribe: { mail: 'unsubscribe@example.com' } });
    assert.match(mail.html, /src="data:image\/png;base64,/);
    assert.match(mail.text, /Plain text with https:\/\/example.com\/path continued/);
    assert.match(mail.textAsHtml, /<a href="https:\/\/example.com\/path">/);
    assert.strictEqual(mail.attachments.length, 2);
    assert.strictEqual(mail.attachments[1].filename, 'report.pdf');
    assert.strictEqual(mail.attachments[1].contentType, 'application/pdf');
    assert.strictEqual(mail.attachments[1].content.toString(), '%PDF-1.4 smoke');
    assert.strictEqual(mail.attachments[1].checksum, require('node:crypto').createHash('md5').update('%PDF-1.4 smoke').digest('hex'));

    // The streaming parser, fed from a stream
    const seen = [];
    await new Promise((resolve, reject) => {
        const parser = new mailparser.MailParser();
        parser.on('headers', headers => seen.push('headers:' + headers.get('subject')));
        parser.on('data', data => {
            if (data.type === 'attachment') {
                seen.push('attachment:' + data.contentType);
                data.content.on('data', () => false);
                data.content.on('end', () => data.release());
            } else {
                seen.push('text');
            }
        });
        parser.on('error', reject);
        parser.on('end', resolve);
        Readable.from([Buffer.from(message)]).pipe(parser);
    });
    assert.deepStrictEqual(seen, ['headers:Tere, maailm', 'attachment:image/png', 'attachment:application/pdf', 'text']);

    console.log('CommonJS smoke test passed (' + process.version + ', ' + (process.env.NODE_OPTIONS || 'no NODE_OPTIONS') + ')');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
