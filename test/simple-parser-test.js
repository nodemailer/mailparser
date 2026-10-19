'use strict';

const { test } = require('node:test');

const simpleParser = require('..').simpleParser;
const fs = require('fs');
const Iconv = require('iconv').Iconv;

test('Parse message', (t, done) => {
    simpleParser(fs.createReadStream(__dirname + '/fixtures/nodemailer.eml'), (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);
        t.assert.strictEqual(mail.attachments.length, 4);
        t.assert.strictEqual(mail.attachments[2].checksum, '2822cbcf68de083b96ac3921d0e308a2');
        t.assert.ok(mail.html.indexOf('data:image/png;base64,iVBORw0KGgoAAAANSU') >= 0);
        t.assert.strictEqual(mail.subject, 'Nodemailer is unicode friendly ✔ (1476358788189)');
        t.assert.deepStrictEqual(mail.to, {
            value: [
                // keep indent
                {
                    address: 'andris+123@kreata.ee',
                    name: 'Andris Reinman'
                },
                {
                    address: 'andris.reinman@gmail.com',
                    name: ''
                }
            ],
            html: '<span class="mp_address_group"><span class="mp_address_name">Andris Reinman</span> &lt;<a href="mailto:andris+123@kreata.ee" class="mp_address_email">andris+123@kreata.ee</a>&gt;</span>, <span class="mp_address_group"><a href="mailto:andris.reinman@gmail.com" class="mp_address_email">andris.reinman@gmail.com</a></span>',
            text: '"Andris Reinman" <andris+123@kreata.ee>, andris.reinman@gmail.com'
        });
        done();
    });
});

test('Parse message with large plaintext content', (t, done) => {
    simpleParser(fs.createReadStream(__dirname + '/fixtures/large_text.eml'), (err, mail) => {
        t.assert.ifError(err);

        t.assert.ok(mail);
        t.assert.ok(mail.textAsHtml);
        t.assert.ok(mail.text);
        t.assert.ok(!mail.html);

        done();
    });
});

test('Parse spam message', (t, done) => {
    simpleParser(fs.createReadStream(__dirname + '/fixtures/spam.eml'), (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);
        t.assert.ok(mail.html.trim());
        done();
    });
});

test('Linkify <> enclosed link', (t, done) => {
    let source = `Content-Type: text/plain; charset=utf-8
Subject: linkify test

abc <https://www.gmail.com/> def @andrisreinman ghi`;

    let expectedTextAsHtml =
        '<p>abc &lt;<a href="https://www.gmail.com/">https://www.gmail.com/</a>&gt; def <a href="https://twitter.com/andrisreinman">@andrisreinman</a> ghi</p>';
    simpleParser(source, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        t.assert.strictEqual(mail.textAsHtml.trim(), expectedTextAsHtml);

        done();
    });
});

test('Parse using Iconv', (t, done) => {
    let source = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=ISO-2022-JP
Subject: =?ISO-2022-JP?B?GyRCM1g5OzU7PVEwdzgmPSQ4IUYkMnFKczlwGyhC?=

`),
        Buffer.from('GyRCM1g5OzU7PVEwdzgmPSQ4IUYkMnFKczlwGyhC', 'base64')
    ]);

    let expected = '学校技術員研修検討会報告';

    simpleParser(source, { Iconv }, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);
        t.assert.strictEqual(mail.headers.get('subject').trim(), expected);
        t.assert.strictEqual(mail.text.trim(), expected);

        done();
    });
});

test('Parse using encoding-japanese', (t, done) => {
    let source = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset=ISO-2022-JP
Subject: =?ISO-2022-JP?B?GyRCM1g5OzU7PVEwdzgmPSQ4IUYkMnFKczlwGyhC?=

`),
        Buffer.from('GyRCM1g5OzU7PVEwdzgmPSQ4IUYkMnFKczlwGyhC', 'base64')
    ]);

    let expected = '学校技術員研修検討会報告';

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);
        t.assert.strictEqual(mail.headers.get('subject').trim(), expected);
        t.assert.strictEqual(mail.text.trim(), expected);

        done();
    });
});

test('Parse iso-8859-8-i charset', (t, done) => {
    let source = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset="iso-8859-8-i"

`),
        Buffer.from('+ezl7SDy5ezt', 'base64')
    ]);

    let expected = 'שלום עולם';

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);
        t.assert.strictEqual(mail.text.trim(), expected);
        t.assert.ok(!mail.text.includes('\uFFFD'));

        done();
    });
});

test('Parse iso-8859-8-e charset', (t, done) => {
    let source = Buffer.concat([
        Buffer.from(`Content-Type: text/plain; charset="iso-8859-8-e"

`),
        Buffer.from('+ezl7SDy5ezt', 'base64')
    ]);

    let expected = 'שלום עולם';

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);
        t.assert.strictEqual(mail.text.trim(), expected);
        t.assert.ok(!mail.text.includes('\uFFFD'));

        done();
    });
});

test('Parse encoded address string', (t, done) => {
    let source = Buffer.from(
        `From: test@example.com
To: =?utf-8?B?IlJ5ZGVsIiA8UnlkZWxrYWxvdEAxN2d1YWd1YS5jb20+?=, andris@tr.ee

test`
    );

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        // the encoded word decodes into a display name only, in header order
        t.assert.deepStrictEqual(mail.to.value, [
            { address: '', name: '"Rydel" <Rydelkalot@17guagua.com>' },
            { address: 'andris@tr.ee', name: '' }
        ]);

        done();
    });
});

test('Report the first occurrence of a duplicated singleton header', (t, done) => {
    // mailsplit parses the body by the first Content-Type, and mail clients show the first
    // From and Subject, so the header map must not report the last one instead
    let source = Buffer.from(
        'Subject: one\r\nSubject: two\r\nFrom: first@a.com\r\nFrom: last@b.com\r\nContent-Type: text/plain\r\nContent-Type: text/html\r\n\r\nbody'
    );

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        t.assert.strictEqual(mail.subject, 'one');
        t.assert.strictEqual(mail.from.value[0].address, 'first@a.com');
        t.assert.strictEqual(mail.headers.get('content-type').value, 'text/plain');
        t.assert.strictEqual(mail.text, 'body');
        t.assert.ok(!mail.html);

        done();
    });
});

test('Do not decode an RFC 2231 parameter a second time', (t, done) => {
    // once decoded by libmime the value spells out an encoded word, a second pass would
    // turn it into "invoice.exe" while a gateway that decodes once sees the encoded word
    let source = Buffer.from(
        "Content-Type: application/pdf; name*=utf-8''invoice%3D%3Futf-8%3FQ%3F%3D2Eexe%3F%3D\r\n" +
            "Content-Disposition: attachment; filename*=utf-8''invoice%3D%3Futf-8%3FQ%3F%3D2Eexe%3F%3D\r\n\r\ntest"
    );

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        t.assert.strictEqual(mail.headers.get('content-type').params.name, 'invoice=?utf-8?Q?=2Eexe?=');
        t.assert.strictEqual(mail.headers.get('content-disposition').params.filename, 'invoice=?utf-8?Q?=2Eexe?=');

        // a plain parameter is still decoded
        simpleParser(Buffer.from('Content-Disposition: attachment; filename="=?utf-8?Q?invoice=2Etxt?="\r\n\r\ntest'), {}, (err, mail) => {
            t.assert.ifError(err);
            t.assert.strictEqual(mail.headers.get('content-disposition').params.filename, 'invoice.txt');
            done();
        });
    });
});

test('Parse encoded content-disposition', (t, done) => {
    let source = Buffer.from(
        `Content-Disposition: =?utf-8?Q?inline?=
Subject: test

test`
    );

    simpleParser(source, {}, (err, mail) => {
        t.assert.ifError(err);
        t.assert.ok(mail);

        t.assert.strictEqual(mail.text, 'test');

        done();
    });
});
/*
module.exports['Parse invalid date'] = test => {
    let source = Buffer.from(
        `Date: Tue, 06 Jul 2021 19:21:59 CEST
Subject: test

test`
    );

    simpleParser(source, {}, (err, mail) => {
        test.ifError(err);
        test.ok(mail);

        test.equal(mail.date.toISOString(), '2021-07-06T17:21:59.000Z');

        test.done();
    });
};
*/
const RFC_2822_date = {
    // commented cases where new Date(val) uses local timezone
    '01 Apr 2013 20:18:36 -0500': '2013-04-02T01:18:36.000Z',
    //'            01/03/2006': '2006-01-03T08:00:00.000Z',
    //'03/11/2014 11:44 AM (GMT-06:00)': '2014-03-11T18:44:00.000Z',
    // '2008-10-23, 1:52PM CDT'       : '2008-10-23T13:42:00.000Z',
    '21 Jan 2013 13:03:51 -0600': '2013-01-21T19:03:51.000Z',
    //'4 December 2005': '2005-12-04T08:00:00.000Z',
    'Fri, 02 Dec 2011 09:27:26 -0600': '2011-12-02T15:27:26.000Z',
    'Fri, 07 Mar 2008 02:35:23 -0800 (PST)': '2008-03-07T10:35:23.000Z',
    'Fri, 07 Mar 2014 11:01:40 UTC': '2014-03-07T11:01:40.000Z',
    'January 6, 2009 4:44:14 PM CST': '2009-01-06T22:44:14.000Z',
    'Sun, 8 Jan 2017 20:37:44 +0200': '2017-01-08T18:37:44.000Z'
};

for (const d in RFC_2822_date) {
    test(`Parses email date: ${d}`, (t, done) => {
        simpleParser(Buffer.from(`Date: ${d}\r\nSubject: test\r\n\r\ntest`), {}, (err, mail) => {
            t.assert.ifError(err);
            t.assert.ok(mail);

            t.assert.strictEqual(mail.date.toISOString(), RFC_2822_date[d]);

            done();
        });
    });
}
