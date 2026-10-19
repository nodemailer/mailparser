'use strict';

const { describe, it, test } = require('node:test');

const MailParser = require('..').MailParser;
const simpleParser = require('..').simpleParser;
const iconv = require('iconv-lite');
const fs = require('fs');
const crypto = require('crypto');

describe('General tests', () => {
    it('Many chunks', (t, done) => {
        let encodedText = 'Content-Type: text/plain; charset=utf-8\r\n\r\nÕÄ\r\nÖÜ', // \r\nÕÄÖÜ
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();

        mailparser.on('data', () => false);

        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄ\nÖÜ');
            done();
        });

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }

        mailparser.end();
    });

    it('Many chunks - split line endings', (t, done) => {
        let chunks = ['Content-Type: text/plain; charset=utf-8\r', '\nSubject: Hi Mom\r\n\r\n', 'hello'];

        t.plan(1);
        let mailparser = new MailParser();

        let writeNextChunk = function () {
            let chunk = chunks.shift();
            if (chunk) {
                mailparser.write(chunk, 'utf8');
                if (typeof setImmediate === 'function') {
                    setImmediate(writeNextChunk);
                } else {
                    process.nextTick(writeNextChunk);
                }
            } else {
                mailparser.end();
            }
        };

        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'hello');
            done();
        });

        if (typeof setImmediate === 'function') {
            setImmediate(writeNextChunk);
        } else {
            process.nextTick(writeNextChunk);
        }
    });

    it('Headers only', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nSubject: ÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.headers.get('subject'), 'ÕÄÖÜ');
            done();
        });
    });

    it('Body only', (t, done) => {
        let encodedText = '\r\n===',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, '===');
            done();
        });
    });

    it('Different line endings', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\nSubject: ÕÄÖÜ\n\n1234\r\nÕÄÖÜ\r\nÜÖÄÕ\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(2);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.headers.get('subject'), 'ÕÄÖÜ');
            t.assert.strictEqual(mailparser.text, '1234\nÕÄÖÜ\nÜÖÄÕ\n1234');
            done();
        });
    });

    it('Headers event', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                'X-Test: =?UTF-8?Q?=C3=95=C3=84?= =?UTF-8?Q?=C3=96=C3=9C?=\r\n' +
                'Subject: ABCDEF\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment; filename="test.pdf"\r\n' +
                '\r\n' +
                'AAECAwQFBg==\r\n' +
                '--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(3);
        let mailparser = new MailParser();

        mailparser.on('headers', headers => {
            t.assert.strictEqual(headers.get('subject'), 'ABCDEF');
            t.assert.strictEqual(headers.get('x-test'), '=?UTF-8?Q?=C3=95=C3=84?= =?UTF-8?Q?=C3=96=C3=9C?=');
        });

        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data && data.release) {
                data.content.on('data', () => false);
                data.content.on('end', () => false);
                data.release();
            }
        });

        mailparser.on('end', () => {
            t.assert.ok(1, 'Parsing ended');
            done();
        });
    });

    it('HeaderLines event', (t, done) => {
        let encodedText = 'X-Test: =?UTF-8?Q?=C3=95=C3=84?= =?UTF-8?Q?=C3=96=C3=9C?=\r\nSubject: ABCDEF',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(3);
        let mailparser = new MailParser();

        mailparser.on('headerLines', headerLines => {
            t.assert.strictEqual(!!headerLines.find(({ line }) => line === 'X-Test: =?UTF-8?Q?=C3=95=C3=84?= =?UTF-8?Q?=C3=96=C3=9C?='), true);
            t.assert.strictEqual(!!headerLines.find(({ line }) => line === 'Subject: ABCDEF'), true);
        });

        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data && data.release) {
                data.content.on('data', () => false);
                data.content.on('end', () => false);
                data.release();
            }
        });

        mailparser.on('end', () => {
            t.assert.ok(1, 'Parsing ended');
            done();
        });
    });

    it('No priority', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nSubject: ÕÄÖÜ\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.headers.has('priority'), false);
            done();
        });
    });

    it('MS Style priority', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nSubject: ÕÄÖÜ\nX-Priority: 1 (Highest)\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.headers.get('priority'), 'high');
            done();
        });
    });

    it('Single reference', (t, done) => {
        let encodedText = 'Content-type: text/plain\r\nReferences: <mail1>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.deepStrictEqual(mailparser.headers.get('references'), '<mail1>');
            done();
        });
    });

    it('Multiple reference values', (t, done) => {
        let encodedText = 'Content-type: text/plain\r\nReferences: <mail1>\n    <mail2> <mail3>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.deepStrictEqual(mailparser.references, ['<mail1>', '<mail2>', '<mail3>']);
            done();
        });
    });

    it('Multiple reference fields', (t, done) => {
        let encodedText = 'Content-type: text/plain\r\nReferences: <mail1>\nReferences: <mail3>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.deepStrictEqual(mailparser.references, ['<mail1>', '<mail3>']);
            done();
        });
    });

    it('Single in-reply-to', (t, done) => {
        let encodedText = 'Content-type: text/plain\r\nin-reply-to: <mail1>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.deepStrictEqual(mailparser.inReplyTo, '<mail1>');
            done();
        });
    });

    it('Multiple in-reply-to values', (t, done) => {
        let encodedText = 'Content-type: text/plain\r\nin-reply-to: <mail1>\n    <mail2> <mail3>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.deepStrictEqual(mailparser.inReplyTo, '<mail1> <mail2> <mail3>');
            done();
        });
    });

    it('Multiple in-reply-to fields', (t, done) => {
        let encodedText = 'Content-type: text/plain\r\nin-reply-to: <mail1>\nin-reply-to: <mail3>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            // the first occurrence of a singleton header is the one reported
            t.assert.deepStrictEqual(mailparser.inReplyTo, '<mail1>');
            done();
        });
    });

    it('Reply To address', (t, done) => {
        let encodedText = 'Reply-TO: andris <andris@disposebox.com>\r\nSubject: ÕÄÖÜ\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.deepStrictEqual(mailparser.replyTo.value, [
                {
                    name: 'andris',
                    address: 'andris@disposebox.com'
                }
            ]);
            done();
        });
    });
});

describe('Text encodings', () => {
    it('Plaintext encoding: Default', (t, done) => {
        let mail = Buffer.from('\r\nÕÄÖÜ');

        t.plan(1);

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });

    it('Plaintext encoding: Header defined', (t, done) => {
        let encodedText = 'Content-Type: TEXT/PLAIN; CHARSET=UTF-8\r\n\r\nÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });

    it('HTML encoding: Header defined', (t, done) => {
        let encodedText = 'Content-Type: text/html; charset=iso-UTF-8\r\n\r\nÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        t.plan(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.html, 'ÕÄÖÜ');
            done();
        });
    });

    it('Mime Words', (t, done) => {
        let encodedText =
                'Content-type: text/plain; charset=utf-8\r\n' +
                'From: =?utf-8?q?ender?= <sender@email.com>\r\n' +
                'To: =?ISO-8859-1?Q?Keld_J=F8rn_Simonsen?= <to@email.com>\r\n' +
                'Subject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.subject, 'Avaldus lepingu lõpetamiseks');
            t.assert.strictEqual(mailparser.from.value[0].name, 'ender');
            t.assert.strictEqual(mailparser.to.value[0].name, 'Keld Jørn Simonsen');
            done();
        });
    });

    it('Mime Words With Colon', (t, done) => {
        let encodedText =
                'Content-type: text/plain; charset=utf-8\r\n' +
                'From: =?utf-8?Q?=3A.Good=20Test.=3A?= <sender@email.com>\r\n' +
                'To: =?ISO-8859-1?Q?Keld_J=F8rn_Simonsen?= <to@email.com>\r\n' +
                'Subject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.subject, 'Avaldus lepingu lõpetamiseks');
            t.assert.strictEqual(mailparser.from.value[0].name, ':.Good Test.:');
            t.assert.strictEqual(mailparser.to.value[0].name, 'Keld Jørn Simonsen');
            done();
        });
    });

    it('Punycode Address', (t, done) => {
        let encodedText = 'From: "Sender" <sender@xn--mnchen-ost-9db.test.fm>\r\nTo: "Test Recipient" <to@email.com>\r\n',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.from.value[0].address, 'sender@münchen-ost.test.fm');
            t.assert.strictEqual(mailparser.to.value[0].address, 'to@email.com');
            done();
        });
    });

    it('Punycode Address: Invalid', (t, done) => {
        let encodedText = 'From: "Postmaster" <postmaster@xn--mnchen-ost-9db-test-fm.bounce-mta.com>\r\nTo: "Test Recipient" <to@email.com>\r\n',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.from.value[0].address, 'postmaster@xn--mnchen-ost-9db-test-fm.bounce-mta.com');
            t.assert.strictEqual(mailparser.to.value[0].address, 'to@email.com');
            done();
        });
    });
});

describe('Binary attachment encodings', () => {
    it('Quoted-Printable', (t, done) => {
        let encodedText = 'Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(Array.prototype.slice.apply((attachments[0].content && attachments[0].content) || []).join(','), '0,1,2,3,253,254,255');
            done();
        });
    });
    /*Base64: test => {
        let encodedText = 'Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\nAAECA/3+/w==',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            test.equal(Array.prototype.slice.apply((attachments[0].content && attachments[0].content) || []).join(','), '0,1,2,3,253,254,255');
            test.done();
        });
    },*/
    it('8bit', (t, done) => {
        let encodedText = 'Content-Type: application/octet-stream\r\n\r\nÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(
                Array.prototype.slice.apply((attachments[0].content && attachments[0].content) || []).join(','),
                '195,149,195,132,195,150,195,156'
            );
            done();
        });
    });
});

describe('Attachment Content-Id', () => {
    it('Default', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
                'Content-Disposition: attachment; filename="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.ok(!attachments[0].contentId);
            done();
        });
    });

    it('Defined', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
                'Content-Disposition: attachment; filename="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="\r\n' +
                'Content-Id: <test@localhost>\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].contentId, '<test@localhost>');
            done();
        });
    });
});

describe('Attachment filename', () => {
    it('Content-Disposition filename', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
                'Content-Disposition: attachment; filename="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            done();
        });
    });
    it('Content-Disposition filename*', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
                'Content-Disposition: attachment; filename*="UTF-8\'\'%C3%95%C3%84%C3%96%C3%9C"\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            done();
        });
    });
    it('Content-Disposition filename*X', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
                'Content-Disposition: attachment;\r\n' +
                '    filename*0=OA;\r\n' +
                '    filename*1=U;\r\n' +
                '    filename*2=.txt\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].content && attachments[0].filename, 'OAU.txt');
            done();
        });
    });
    it('Content-Disposition filename*X*', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
                'Content-Disposition: attachment;\r\n' +
                '    filename*0*=UTF-8\x27\x27%C3%95%C3%84;\r\n' +
                '    filename*1*=%C3%96%C3%9C\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            done();
        });
    });
    it('Content-Disposition filename*X* mixed', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
                'Content-Disposition: attachment;\r\n' +
                '    filename*0*=UTF-8\x27\x27%C3%95%C3%84;\r\n' +
                '    filename*1*=%C3%96%C3%9C;\r\n' +
                '    filename*2=.txt\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ.txt');
            done();
        });
    });

    it('Content-Type name', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream; name="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="\r\n' +
                'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            done();
        });
    });
    it('Content-Type unknown; name', (t, done) => {
        let encodedText = 'Content-Type: unknown; name="test"\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].filename, 'test');
            done();
        });
    });
    it('Content-Type name*', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream;\r\n' +
                '    name*=UTF-8\x27\x27%C3%95%C3%84%C3%96%C3%9C\r\n' +
                'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            done();
        });
    });
    it('Content-Type name*X*', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream;\r\n' +
                '    name*0*=UTF-8\x27\x27%C3%95%C3%84;\r\n' +
                '    name*1*=%C3%96%C3%9C\r\n' +
                'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            done();
        });
    });
    it('Multiple filenames - Same', (t, done) => {
        let encodedText =
                'Content-Type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream; name="test.txt"\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream; name="test.txt"\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF\r\n' +
                '--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].content && attachments[0].filename, 'test.txt');
            t.assert.strictEqual(attachments && attachments[1] && attachments[1].content && attachments[1].filename, 'test.txt');
            done();
        });
    });
    it('Multiple filenames - Different', (t, done) => {
        let encodedText =
                'Content-Type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream; name="test.txt"\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF\r\n' +
                '--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(!attachments[0].filename, true);
            t.assert.strictEqual(attachments[1].filename, 'test.txt');
            done();
        });
    });
    it('Filename with semicolon', (t, done) => {
        let encodedText =
                'Content-Type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Disposition: attachment; filename="hello;world;test.txt"\r\n' +
                '\r\n' +
                '=00=01=02=03=FD=FE=FF\r\n' +
                '--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].content && attachments[0].filename, 'hello;world;test.txt');
            done();
        });
    });
});

describe('Plaintext format', () => {
    it('Default', (t, done) => {
        let encodedText = 'Content-Type: text/plain;\r\n\r\nFirst line \r\ncontinued',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'First line \ncontinued');
            done();
        });
    });
    it('Flowed', (t, done) => {
        let encodedText = 'Content-Type: text/plain; format=flowed\r\n\r\nFirst line \r\ncontinued \r\nand so on',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'First line continued and so on');
            done();
        });
    });
    it('Flowed Signature', (t, done) => {
        let encodedText = 'Content-Type: text/plain; format=flowed\r\n\r\nHow are you today?\r\n\r\n-- \r\nSignature\r\n',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'How are you today?\n\n-- \nSignature');
            done();
        });
    });
    it('Fixed', (t, done) => {
        let encodedText = 'Content-Type: text/plain; format=fixed\r\n\r\nFirst line \r\ncontinued \r\nand so on',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'First line \ncontinued \nand so on');
            done();
        });
    });
    it('DelSp', (t, done) => {
        let encodedText = 'Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\nFirst line \r\ncontinued \r\nand so on',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'First linecontinuedand so on');
            done();
        });
    });
});

describe('Transfer encoding', () => {
    it('Quoted-Printable Default charset', (t, done) => {
        let encodedText = 'Content-type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=C3=95=C3=84=C3=96=C3=9C',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('Quoted-Printable Win-1257', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=windows-1257\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=D5=C4=D6=DC',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('Quoted-Printable UTF-8', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=C3=95=C3=84=C3=96=C3=9C',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('Base64 Default charset', (t, done) => {
        let encodedText = 'Content-type: text/plain\r\nContent-Transfer-Encoding: bAse64\r\n\r\nw5XDhMOWw5w=',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('Base64 Win-1257', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=windows-1257\r\nContent-Transfer-Encoding: bAse64\r\n\r\n1cTW3A==',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('Base64 UTF-8', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: bAse64\r\n\r\nw5XDhMOWw5w=',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('Mime Words', (t, done) => {
        let encodedText =
                'Content-type: text/plain; charset=utf-8\r\nSubject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.subject, 'Avaldus lepingu lõpetamiseks');
            done();
        });
    });
    it('8bit Default charset', (t, done) => {
        let encodedText = 'Content-type: text/plain\r\nContent-Transfer-Encoding: 8bit\r\n\r\nÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('8bit Win-1257', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=win-1257\r\nContent-Transfer-Encoding: 8bit\r\n\r\nÕÄÖÜ',
            textmap = encodedText.split('').map(chr => chr.charCodeAt(0)),
            mail = Buffer.from(textmap);

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('8bit UTF-8', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('Invalid Quoted-Printable', (t, done) => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n==C3==95=C3=84=C3=96=C3=9C=',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, '=�=�ÄÖÜ');
            done();
        });
    });
    it('gb2312 mime words', (t, done) => {
        let encodedText = 'From: =?gb2312?B?086yyZjl?= user@ldkf.com.tw\r\n\r\nBody',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.deepStrictEqual(mailparser.from.value, [
                {
                    address: 'user@ldkf.com.tw',
                    name: '游采樺'
                }
            ]);
            done();
        });
    });
    it('Valid Date header', (t, done) => {
        let encodedText = 'Date: Wed, 08 Jan 2014 09:52:26 -0800\r\n\r\n1cTW3A==',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.date.toISOString(), '2014-01-08T17:52:26.000Z');
            done();
        });
    });
    it('Invalid Date header', (t, done) => {
        let encodedText = 'Date: zzzzz\r\n\r\n1cTW3A==',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.ok(!mail.date);
            done();
        });
    });
    it('Missing Date header', (t, done) => {
        let encodedText = 'Subject: test\r\n\r\n1cTW3A==',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.ok(!mail.date);
            done();
        });
    });
});

describe('Multipart content', () => {
    it('Simple', (t, done) => {
        let encodedText = 'Content-type: multipart/mixed; boundary=ABC\r\n\r\n--ABC\r\nContent-type: text/plain; charset=utf-8\r\n\r\nÕÄÖÜ\r\n--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('Nested', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-type: multipart/related; boundary=DEF\r\n' +
                '\r\n' +
                '--DEF\r\n' +
                'Content-type: text/plain; charset=utf-8\r\n' +
                '\r\n' +
                'ÕÄÖÜ\r\n' +
                '--DEF--\r\n' +
                '--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('Inline text (Sparrow)', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: text/plain; charset="utf-8"\r\n' +
                'Content-Transfer-Encoding: 8bit\r\n' +
                'Content-Disposition: inline\r\n' +
                '\r\n' +
                'ÕÄÖÜ\r\n' +
                '--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ');
            done();
        });
    });
    it('Different Levels', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-type: text/html; charset=utf-8\r\n' +
                '\r\n' +
                'ÕÄÖÜ2\r\n' +
                '--ABC\r\n' +
                'Content-type: multipart/related; boundary=DEF\r\n' +
                '\r\n' +
                '--DEF\r\n' +
                'Content-type: text/plain; charset=utf-8\r\n' +
                '\r\n' +
                'ÕÄÖÜ1\r\n' +
                '--DEF--\r\n' +
                '--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            t.assert.strictEqual(mailparser.text, 'ÕÄÖÜ2\nÕÄÖÜ1');
            t.assert.strictEqual(mailparser.html, 'ÕÄÖÜ2<br/>\n<p>&Otilde;&Auml;&Ouml;&Uuml;1</p>');
            done();
        });
    });
});

describe('Attachment info', () => {
    it('Included integrity', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: quoted-printable\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                '=00=01=02=03=04=05=06\r\n' +
                '--ABC--',
            expectedHash = '9aa461e1eca4086f9230aa49c90b0c61',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }
        mailparser.end();

        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].checksum, expectedHash);
            t.assert.strictEqual(attachments[0].size, 7);
            done();
        });
    });
    it('Stream integrity base64', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                'AAECAwQFBg==\r\n' +
                '--ABC--',
            expectedHash = '9aa461e1eca4086f9230aa49c90b0c61',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }

        t.plan(2);

        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        mailparser.end();
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].checksum, expectedHash);
            t.assert.strictEqual(attachments[0].size, 7);
            done();
        });
    });
    it('Stream integrity - 8bit', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: 8bit\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                'ÕÄ\r\n' +
                'ÖÜ\r\n' +
                '--ABC--',
            expectedHash = 'cad0f72629a7245dd3d2cbf41473e3ca',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();

        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }

        t.plan(2);

        mailparser.end();
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].checksum, expectedHash);
            t.assert.strictEqual(attachments[0].size, 10);
            done();
        });
    });
    it('Stream integrity - binary, non utf-8', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: 8bit\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                'ÕÄ\r\n' +
                'ÖÜ\r\n' +
                'ŽŠ\r\n' +
                '--ABC--',
            expectedHash = '34bca86f8cc340bbd11446ee16ee3cae',
            mail = iconv.encode(encodedText, 'iso-8859-13');

        let attachments = [];
        let mailparser = new MailParser();

        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }

        t.plan(2);

        mailparser.end();
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].checksum, expectedHash);
            t.assert.strictEqual(attachments[0].size, 10);
            done();
        });
    });
    it('Stream integrity - qp, non utf-8', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream; charset=iso-8859-13\r\n' +
                'Content-Transfer-Encoding: quoted-printable\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                '=d5=c4\r\n' +
                '=d6=dc\r\n' +
                '=de=d0\r\n' +
                '--ABC--',
            expectedHash = '34bca86f8cc340bbd11446ee16ee3cae',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();

        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }

        t.plan(2);

        mailparser.end();
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].checksum, expectedHash);
            t.assert.strictEqual(attachments[0].size, 10);
            done();
        });
    });
    it('Attachment in root node', (t, done) => {
        let encodedText =
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: 8bit\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                'ÕÄ\r\n' +
                'ÖÜ',
            expectedHash = 'cad0f72629a7245dd3d2cbf41473e3ca',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser({
            streamAttachments: true
        });

        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }

        t.plan(2);

        mailparser.end();
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].checksum, expectedHash);
            t.assert.strictEqual(attachments[0].size, 10);
            done();
        });
    });
    it('Attachment checksum: an unavailable algorithm is a parser error, not a crash', (t, done) => {
        let encodedText =
            'Content-Type: multipart/mixed; boundary=ABC\r\n' +
            '\r\n' +
            '--ABC\r\n' +
            'Content-Type: application/octet-stream\r\n' +
            'Content-Transfer-Encoding: base64\r\n' +
            'Content-Disposition: attachment\r\n' +
            '\r\n' +
            'AAECAwQFBg==\r\n' +
            '--ABC--';

        t.plan(2);

        simpleParser(Buffer.from(encodedText, 'utf-8'), { checksumAlgo: 'not-a-hash' })
            .then(() => {
                t.assert.ok(false, 'should have rejected');
                done();
            })
            .catch(err => {
                t.assert.ok(err instanceof Error);
                t.assert.ok(/not-a-hash/.test(err.message));
                done();
            });
    });

    it('Attachment checksum: sha256', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                'AAECAwQFBg==\r\n' +
                '--ABC--',
            expectedHash = '57355ac3303c148f11aef7cb179456b9232cde33a818dfda2c2fcb9325749a6b',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let options = { checksumAlgo: 'sha256' };
        let mailparser = new MailParser(options);

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }

        t.plan(2);

        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        mailparser.end();
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].checksum, expectedHash);
            t.assert.strictEqual(attachments[0].size, 7);
            done();
        });
    });
    it('Stream multiple attachments', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                'AAECAwQFBg==\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                'AAECAwQFBg==\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment; filename="test.txt"\r\n' +
                '\r\n' +
                'AAECAwQFBg==\r\n' +
                '--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser({
            streamAttachments: true
        });

        t.plan(3); // should be 3 attachments

        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                t.assert.ok(data);
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        mailparser.end(mail);
        mailparser.on('end', () => {
            done();
        });
    });
    it('Detect Content-Type by filename', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=ABC\r\n' +
                '\r\n' +
                '--ABC\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: base64\r\n' +
                'Content-Disposition: attachment; filename="test.pdf"\r\n' +
                '\r\n' +
                'AAECAwQFBg==\r\n' +
                '--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();

        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                t.assert.ok(data);
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        mailparser.write(mail);
        mailparser.end();
        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].contentType, 'application/pdf');
            done();
        });
    });
});

test('Advanced nested HTML', (t, done) => {
    let mail = fs.readFileSync(__dirname + '/fixtures/nested.eml');

    t.plan(2);
    let mailparser = new MailParser();

    for (let i = 0, len = mail.length; i < len; i++) {
        mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.end();
    mailparser.on('data', () => false);
    mailparser.on('end', () => {
        t.assert.strictEqual(mailparser.text, '\nDear Sir,\n\nGood evening.\n\n\n\n\n\n\n\nThe footer\n');
        t.assert.strictEqual(mailparser.html, '<p>Dear Sir</p>\n<p>Good evening.</p>\n<p></p><br/>\n<p>The footer</p>\n');
        done();
    });
});

test('Skip html to text', (t, done) => {
    let encodedText = Buffer.from('Content-type: text/html; charset=utf-8\r\n\r\n<div>text</div>'),
        mail = Buffer.from(encodedText, 'utf-8');

    t.plan(2);
    let mailparser = new MailParser({ skipHtmlToText: true });
    mailparser.end(mail);
    mailparser.on('data', () => false);
    mailparser.on('end', () => {
        t.assert.strictEqual(mailparser.text, '');
        t.assert.strictEqual(mailparser.html, '<div>text</div>');
        done();
    });
});

test('Skip text to html', (t, done) => {
    let mail = fs.readFileSync(__dirname + '/fixtures/large_text.eml');

    t.plan(2);
    let mailparser = new MailParser({ skipTextToHtml: true });

    for (let i = 0, len = mail.length; i < len; i++) {
        mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.end();
    mailparser.on('data', () => false);
    mailparser.on('end', () => {
        t.assert.strictEqual(mailparser.text.split('\n')[0], 'Exception during installation:');
        t.assert.strictEqual(mailparser.textAsHtml, '');
        done();
    });
});

test('Additional text', (t, done) => {
    let mail = fs.readFileSync(__dirname + '/fixtures/mixed.eml');

    t.plan(2);
    let mailparser = new MailParser();

    for (let i = 0, len = mail.length; i < len; i++) {
        mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.end();
    mailparser.on('data', () => false);
    mailparser.on('end', () => {
        t.assert.strictEqual(mailparser.text, '\nThis e-mail message has been scanned for Viruses and Content and cleared\n\nGood Morning;\n\n');
        t.assert.strictEqual(
            mailparser.html,
            '<HTML><HEAD>\n</HEAD><BODY> \n\n<HR>\nThis e-mail message has been scanned for Viruses and Content and cleared\n<HR>\n</BODY></HTML>\n<br/>\n<p>Good Morning;</p>'
        );
        done();
    });
});

test('Base64 encoded root node', (t, done) => {
    let mail = fs.readFileSync(__dirname + '/fixtures/base64encodedroot.eml');

    t.plan(2);
    let mailparser = new MailParser();

    for (let i = 0, len = mail.length; i < len; i++) {
        mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.end();
    const attachments = [];

    mailparser.on('data', data => {
        if (data.type === 'attachment') {
            let chunks = [];
            data.content.on('data', chunk => chunks.push(chunk));
            data.content.on('end', () => {
                data.content = Buffer.concat(chunks);
                data.release();
            });
            attachments.push(data);
        }
    });

    mailparser.on('end', () => {
        t.assert.strictEqual(1, attachments.length);

        const hash = crypto.createHash('sha256');
        hash.update(attachments[0].content);
        t.assert.strictEqual(hash.digest('hex'), '3d0c2d17edd1fed968f66ca200e7c165efd63834b488eec53deb24cca49c3d7b');
        done();
    });
});
test('Out of memory error', (t, done) => {
    let mail = fs.readFileSync(__dirname + '/fixtures/outofmemory.eml');

    t.plan(4);
    let mailparser = new MailParser({ maxHtmlLengthToParse: 128 * 1024 });

    for (let i = 0, len = mail.length; i < len; i++) {
        mailparser.write(Buffer.from([mail[i]]));
    }

    let mailobj = {};

    mailparser.end();

    mailparser.on('data', data => {
        mailobj.text = data;
    });
    mailparser.on('error', err => {
        // HTML that is too long to convert is reported with the result, not as an error
        t.assert.ifError(err);
    });
    mailparser.on('end', () => {
        t.assert.strictEqual(mailobj.text.text, '');
        t.assert.strictEqual(typeof mailobj.text.html, 'string');
        t.assert.strictEqual(mailobj.text.html.length, 1139579);
        t.assert.strictEqual(mailobj.text.textConversionError.message, 'HTML too long for parsing 1139579 bytes');
        done();
    });
});

describe('Attachment partId', () => {
    it('single part', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=part1\r\n' +
                '\r\n' +
                '--part1\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: quoted-printable\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                '=00=01=02=03=04=05=06\r\n' +
                '--part1--',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }
        mailparser.end();

        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].partId, '1');
            done();
        });
    });
    it('nested part', (t, done) => {
        let encodedText =
                'Content-type: multipart/mixed; boundary=part1\r\n' +
                '\r\n' +
                '--part1\r\n' +
                'Content-Type: multipart/related; type="text/html";boundary=part2\r\n' +
                '\r\n' +
                '--part2\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: quoted-printable\r\n' +
                'Content-Disposition: attachment; filename="test.txt"\r\n' +
                '\r\n' +
                '=00=01=02=03=04=05=06\r\n' +
                '--part2\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: quoted-printable\r\n' +
                'Content-Disposition: attachment; filename="test2.txt"\r\n' +
                '\r\n' +
                '=00=01=02=03=04=05=06\r\n' +
                '--part2\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: quoted-printable\r\n' +
                'Content-Disposition: attachment; filename="test3.txt"\r\n' +
                '\r\n' +
                '=00=01=02=03=04=05=06\r\n' +
                '--part2--\r\n\r\n' +
                '--part1\r\n' +
                'Content-Type: application/octet-stream\r\n' +
                'Content-Transfer-Encoding: quoted-printable\r\n' +
                'Content-Disposition: attachment\r\n' +
                '\r\n' +
                '=00=01=02=03=04=05=06\r\n' +
                '--part1--',
            mail = Buffer.from(encodedText, 'utf-8');

        let attachments = [];
        let mailparser = new MailParser();
        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                let chunks = [];
                data.content.on('data', chunk => chunks.push(chunk));
                data.content.on('end', () => {
                    data.content = Buffer.concat(chunks);
                    data.release();
                });
                attachments.push(data);
            }
        });

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }
        mailparser.end();

        mailparser.on('end', () => {
            t.assert.strictEqual(attachments[0].partId, '1.1');
            t.assert.strictEqual(attachments[1].partId, '1.2');
            t.assert.strictEqual(attachments[2].partId, '1.3');
            t.assert.strictEqual(attachments[3].partId, '2');
            done();
        });
    });
});

// fails for some reason
test('Decoder already ended on cleanup', (t, done) => {
    let mail = fs.readFileSync(__dirname + '/fixtures/decoderended.eml');

    t.plan(1);
    let mailparser = new MailParser();

    for (let i = 0, len = mail.length; i < len; i++) {
        mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.end();
    let mailbodytext = null;

    mailparser.on('data', data => {
        if (data.type === 'text') {
            mailbodytext = data.text;
        }
        if (data.type === 'attachment') {
            data.content.on('data', () => {});
            data.content.on('end', () => data.release());
        }
    });

    mailparser.on('error', err => {
        done(err);
    });

    mailparser.on('end', () => {
        t.assert.strictEqual(
            '\n\nNote: forwarded message attached.\n       \n---------------------------------\nBe a better something.\nCheck it out.',
            mailbodytext
        );
        done();
    });
});
