'use strict';

const MailParser = require('..').MailParser;
const iconv = require('iconv-lite');
const fs = require('fs');
const crypto = require('crypto');

exports['General tests'] = {
    'Many chunks': test => {
        let encodedText = 'Content-Type: text/plain; charset=utf-8\r\n\r\nÕÄ\r\nÖÜ', // \r\nÕÄÖÜ
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();

        mailparser.on('data', () => false);

        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄ\nÖÜ');
            test.done();
        });

        for (let i = 0, len = mail.length; i < len; i++) {
            mailparser.write(Buffer.from([mail[i]]));
        }

        mailparser.end();
    },

    'Many chunks - split line endings': test => {
        let chunks = ['Content-Type: text/plain; charset=utf-8\r', '\nSubject: Hi Mom\r\n\r\n', 'hello'];

        test.expect(1);
        let mailparser = new MailParser();

        let writeNextChunk = function() {
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
            test.equal(mailparser.text, 'hello');
            test.done();
        });

        if (typeof setImmediate === 'function') {
            setImmediate(writeNextChunk);
        } else {
            process.nextTick(writeNextChunk);
        }
    },

    'Headers only': test => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nSubject: ÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.headers.get('subject'), 'ÕÄÖÜ');
            test.done();
        });
    },

    'Body only': test => {
        let encodedText = '\r\n===',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, '===');
            test.done();
        });
    },

    'Different line endings': test => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\nSubject: ÕÄÖÜ\n\n1234\r\nÕÄÖÜ\r\nÜÖÄÕ\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(2);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.headers.get('subject'), 'ÕÄÖÜ');
            test.equal(mailparser.text, '1234\nÕÄÖÜ\nÜÖÄÕ\n1234');
            test.done();
        });
    },

    'Headers event': test => {
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

        test.expect(3);
        let mailparser = new MailParser();

        mailparser.on('headers', headers => {
            test.equal(headers.get('subject'), 'ABCDEF');
            test.equal(headers.get('x-test'), '=?UTF-8?Q?=C3=95=C3=84?= =?UTF-8?Q?=C3=96=C3=9C?=');
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
            test.ok(1, 'Parsing ended');
            test.done();
        });
    },

    'No priority': test => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nSubject: ÕÄÖÜ\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.headers.has('priority'), false);
            test.done();
        });
    },

    'MS Style priority': test => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nSubject: ÕÄÖÜ\nX-Priority: 1 (Highest)\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.headers.get('priority'), 'high');
            test.done();
        });
    },

    'Single reference': test => {
        let encodedText = 'Content-type: text/plain\r\nReferences: <mail1>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.deepEqual(mailparser.headers.get('references'), '<mail1>');
            test.done();
        });
    },

    'Multiple reference values': test => {
        let encodedText = 'Content-type: text/plain\r\nReferences: <mail1>\n    <mail2> <mail3>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.deepEqual(mailparser.references, ['<mail1>', '<mail2>', '<mail3>']);
            test.done();
        });
    },

    'Multiple reference fields': test => {
        let encodedText = 'Content-type: text/plain\r\nReferences: <mail1>\nReferences: <mail3>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.deepEqual(mailparser.references, ['<mail1>', '<mail3>']);
            test.done();
        });
    },

    'Single in-reply-to': test => {
        let encodedText = 'Content-type: text/plain\r\nin-reply-to: <mail1>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.deepEqual(mailparser.inReplyTo, '<mail1>');
            test.done();
        });
    },

    'Multiple in-reply-to values': test => {
        let encodedText = 'Content-type: text/plain\r\nin-reply-to: <mail1>\n    <mail2> <mail3>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.deepEqual(mailparser.inReplyTo, '<mail1> <mail2> <mail3>');
            test.done();
        });
    },

    'Multiple in-reply-to fields': test => {
        let encodedText = 'Content-type: text/plain\r\nin-reply-to: <mail1>\nin-reply-to: <mail3>\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.deepEqual(mailparser.inReplyTo, '<mail3>');
            test.done();
        });
    },

    'Reply To address': test => {
        let encodedText = 'Reply-TO: andris <andris@disposebox.com>\r\nSubject: ÕÄÖÜ\n\r\n1234',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.deepEqual(mailparser.replyTo.value, [
                {
                    name: 'andris',
                    address: 'andris@disposebox.com'
                }
            ]);
            test.done();
        });
    }
};

exports['Text encodings'] = {
    'Plaintext encoding: Default': test => {
        let mail = Buffer.from('\r\nÕÄÖÜ');

        test.expect(1);

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },

    'Plaintext encoding: Header defined': test => {
        let encodedText = 'Content-Type: TEXT/PLAIN; CHARSET=UTF-8\r\n\r\nÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },

    'HTML encoding: Header defined': test => {
        let encodedText = 'Content-Type: text/html; charset=iso-UTF-8\r\n\r\nÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        test.expect(1);
        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.html, 'ÕÄÖÜ');
            test.done();
        });
    },

    'Mime Words': test => {
        let encodedText =
                'Content-type: text/plain; charset=utf-8\r\n' +
                'From: =?utf-8?q?_?= <sender@email.com>\r\n' +
                'To: =?ISO-8859-1?Q?Keld_J=F8rn_Simonsen?= <to@email.com>\r\n' +
                'Subject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.subject, 'Avaldus lepingu lõpetamiseks');
            test.equal(mailparser.from.value[0].name, ' ');
            test.equal(mailparser.to.value[0].name, 'Keld Jørn Simonsen');
            test.done();
        });
    }
};

exports['Binary attachment encodings'] = {
    'Quoted-Printable': test => {
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
            test.equal(Array.prototype.slice.apply((attachments[0].content && attachments[0].content) || []).join(','), '0,1,2,3,253,254,255');
            test.done();
        });
    },
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
                data.content.on('finish', () => {
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
    '8bit': test => {
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
            test.equal(Array.prototype.slice.apply((attachments[0].content && attachments[0].content) || []).join(','), '195,149,195,132,195,150,195,156');
            test.done();
        });
    }
};

exports['Attachment Content-Id'] = {
    Default: test => {
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
            test.ok(!attachments[0].contentId);
            test.done();
        });
    },

    Defined: test => {
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
            test.equal(attachments[0].contentId, '<test@localhost>');
            test.done();
        });
    }
};

exports['Attachment filename'] = {
    'Content-Disposition filename': test => {
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
            test.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Content-Disposition filename*': test => {
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
            test.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Content-Disposition filename*X': test => {
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
            test.equal(attachments[0].content && attachments[0].filename, 'OAU.txt');
            test.done();
        });
    },
    'Content-Disposition filename*X*': test => {
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
            test.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Content-Disposition filename*X* mixed': test => {
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
            test.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ.txt');
            test.done();
        });
    },

    'Content-Type name': test => {
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
            test.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Content-Type unknown; name': test => {
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
            test.equal(attachments[0].filename, 'test');
            test.done();
        });
    },
    'Content-Type name*': test => {
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
            test.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Content-Type name*X*': test => {
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
            test.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Multiple filenames - Same': test => {
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
            test.equal(attachments[0].content && attachments[0].filename, 'test.txt');
            test.equal(attachments && attachments[1] && attachments[1].content && attachments[1].filename, 'test.txt');
            test.done();
        });
    },
    'Multiple filenames - Different': test => {
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
            test.equal(!attachments[0].filename, true);
            test.equal(attachments[1].filename, 'test.txt');
            test.done();
        });
    },
    'Filename with semicolon': test => {
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
            test.equal(attachments[0].content && attachments[0].filename, 'hello;world;test.txt');
            test.done();
        });
    }
};

exports['Plaintext format'] = {
    Default: test => {
        let encodedText = 'Content-Type: text/plain;\r\n\r\nFirst line \r\ncontinued',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'First line \ncontinued');
            test.done();
        });
    },
    Flowed: test => {
        let encodedText = 'Content-Type: text/plain; format=flowed\r\n\r\nFirst line \r\ncontinued \r\nand so on',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'First line continued and so on');
            test.done();
        });
    },
    'Flowed Signature': test => {
        let encodedText = 'Content-Type: text/plain; format=flowed\r\n\r\nHow are you today?\r\n\r\n-- \r\nSignature\r\n',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'How are you today?\n\n-- \nSignature\n');
            test.done();
        });
    },
    Fixed: test => {
        let encodedText = 'Content-Type: text/plain; format=fixed\r\n\r\nFirst line \r\ncontinued \r\nand so on',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'First line \ncontinued \nand so on');
            test.done();
        });
    },
    DelSp: test => {
        let encodedText = 'Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\nFirst line \r\ncontinued \r\nand so on',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'First linecontinuedand so on');
            test.done();
        });
    }
};

exports['Transfer encoding'] = {
    'Quoted-Printable Default charset': test => {
        let encodedText = 'Content-type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=C3=95=C3=84=C3=96=C3=9C',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Quoted-Printable Win-1257': test => {
        let encodedText = 'Content-type: text/plain; charset=windows-1257\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=D5=C4=D6=DC',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Quoted-Printable UTF-8': test => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=C3=95=C3=84=C3=96=C3=9C',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Base64 Default charset': test => {
        let encodedText = 'Content-type: text/plain\r\nContent-Transfer-Encoding: bAse64\r\n\r\nw5XDhMOWw5w=',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Base64 Win-1257': test => {
        let encodedText = 'Content-type: text/plain; charset=windows-1257\r\nContent-Transfer-Encoding: bAse64\r\n\r\n1cTW3A==',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Base64 UTF-8': test => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: bAse64\r\n\r\nw5XDhMOWw5w=',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Mime Words': test => {
        let encodedText =
                'Content-type: text/plain; charset=utf-8\r\nSubject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.subject, 'Avaldus lepingu lõpetamiseks');
            test.done();
        });
    },
    '8bit Default charset': test => {
        let encodedText = 'Content-type: text/plain\r\nContent-Transfer-Encoding: 8bit\r\n\r\nÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    '8bit Win-1257': test => {
        let encodedText = 'Content-type: text/plain; charset=win-1257\r\nContent-Transfer-Encoding: 8bit\r\n\r\nÕÄÖÜ',
            textmap = encodedText.split('').map(chr => chr.charCodeAt(0)),
            mail = Buffer.from(textmap);

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    '8bit UTF-8': test => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nÕÄÖÜ',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Invalid Quoted-Printable': test => {
        let encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n==C3==95=C3=84=C3=96=C3=9C=',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, '=�=�ÄÖÜ');
            test.done();
        });
    },
    'gb2312 mime words': test => {
        let encodedText = 'From: =?gb2312?B?086yyZjl?= user@ldkf.com.tw\r\n\r\nBody',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.deepEqual(mailparser.from.value, [
                {
                    address: 'user@ldkf.com.tw',
                    name: '游采樺'
                }
            ]);
            test.done();
        });
    },
    'Valid Date header': test => {
        let encodedText = 'Date: Wed, 08 Jan 2014 09:52:26 -0800\r\n\r\n1cTW3A==',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.date.toISOString(), '2014-01-08T17:52:26.000Z');
            test.done();
        });
    },
    'Invalid Date header': test => {
        let encodedText = 'Date: zzzzz\r\n\r\n1cTW3A==',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.ok(!mail.date);
            test.done();
        });
    },
    'Missing Date header': test => {
        let encodedText = 'Subject: test\r\n\r\n1cTW3A==',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.ok(!mail.date);
            test.done();
        });
    }
};

exports['Multipart content'] = {
    Simple: test => {
        let encodedText = 'Content-type: multipart/mixed; boundary=ABC\r\n\r\n--ABC\r\nContent-type: text/plain; charset=utf-8\r\n\r\nÕÄÖÜ\r\n--ABC--',
            mail = Buffer.from(encodedText, 'utf-8');

        let mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on('data', () => false);
        mailparser.on('end', () => {
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    Nested: test => {
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
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Inline text (Sparrow)': test => {
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
            test.equal(mailparser.text, 'ÕÄÖÜ');
            test.done();
        });
    },
    'Different Levels': test => {
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
            test.equal(mailparser.text, 'ÕÄÖÜ2\nÕÄÖÜ1');
            test.equal(mailparser.html, 'ÕÄÖÜ2<br/>\n<p>&Otilde;&Auml;&Ouml;&Uuml;1</p>');
            test.done();
        });
    }
};

exports['Attachment info'] = {
    'Included integrity': test => {
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
            test.equal(attachments[0].checksum, expectedHash);
            test.equal(attachments[0].size, 7);
            test.done();
        });
    },
    'Stream integrity base64': test => {
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

        test.expect(2);

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
            test.equal(attachments[0].checksum, expectedHash);
            test.equal(attachments[0].size, 7);
            test.done();
        });
    },
    'Stream integrity - 8bit': test => {
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

        test.expect(2);

        mailparser.end();
        mailparser.on('end', () => {
            test.equal(attachments[0].checksum, expectedHash);
            test.equal(attachments[0].size, 10);
            test.done();
        });
    },
    'Stream integrity - binary, non utf-8': test => {
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

        test.expect(2);

        mailparser.end();
        mailparser.on('end', () => {
            test.equal(attachments[0].checksum, expectedHash);
            test.equal(attachments[0].size, 10);
            test.done();
        });
    },
    'Stream integrity - qp, non utf-8': test => {
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

        test.expect(2);

        mailparser.end();
        mailparser.on('end', () => {
            test.equal(attachments[0].checksum, expectedHash);
            test.equal(attachments[0].size, 10);
            test.done();
        });
    },
    'Attachment in root node': test => {
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

        test.expect(2);

        mailparser.end();
        mailparser.on('end', () => {
            test.equal(attachments[0].checksum, expectedHash);
            test.equal(attachments[0].size, 10);
            test.done();
        });
    },
    'Stream multiple attachments': test => {
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

        test.expect(3); // should be 3 attachments

        mailparser.on('data', data => {
            if (data.type === 'attachment') {
                test.ok(data);
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
            test.done();
        });
    },
    'Detect Content-Type by filename': test => {
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
                test.ok(data);
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
            test.equal(attachments[0].contentType, 'application/pdf');
            test.done();
        });
    }
};

exports['Advanced nested HTML'] = test => {
    let mail = fs.readFileSync(__dirname + '/fixtures/nested.eml');

    test.expect(2);
    let mailparser = new MailParser();

    for (let i = 0, len = mail.length; i < len; i++) {
        mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.end();
    mailparser.on('data', () => false);
    mailparser.on('end', () => {
        test.equal(mailparser.text, '\nDear Sir,\n\nGood evening.\n\n\n\n\n\n\n\nThe footer\n');
        test.equal(mailparser.html, '<p>Dear Sir</p>\n<p>Good evening.</p>\n<p></p><br/>\n<p>The footer</p>\n');
        test.done();
    });
};

exports['Skip html to text'] = test => {
    let encodedText = Buffer.from('Content-type: text/html; charset=utf-8\r\n' +
            '\r\n' +
            '<div>text</div>'),
        mail = Buffer.from(encodedText, 'utf-8');

    test.expect(2);
    let mailparser = new MailParser({ skipHtmlToText: true });
    mailparser.end(mail);
    mailparser.on('data', () => false);
    mailparser.on('end', () => {
        test.equal(mailparser.text, '');
        test.equal(mailparser.html, '<div>text</div>');
        test.done();
    });
};

exports['Skip text to html'] = test => {
    let mail = fs.readFileSync(__dirname + '/fixtures/large_text.eml');

    test.expect(2);
    let mailparser = new MailParser({ skipTextToHtml: true });

    for (let i = 0, len = mail.length; i < len; i++) {
        mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.end();
    mailparser.on('data', () => false);
    mailparser.on('end', () => {
        test.equal(mailparser.text.split('\n')[0], 'Exception during installation:');
        test.equal(mailparser.textAsHtml, '');
        test.done();
    });
};

exports['Additional text'] = test => {
    let mail = fs.readFileSync(__dirname + '/fixtures/mixed.eml');

    test.expect(2);
    let mailparser = new MailParser();

    for (let i = 0, len = mail.length; i < len; i++) {
        mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.end();
    mailparser.on('data', () => false);
    mailparser.on('end', () => {
        test.equal(mailparser.text, '\nThis e-mail message has been scanned for Viruses and Content and cleared\n\nGood Morning;\n\n');
        test.equal(
            mailparser.html,
            '<HTML><HEAD>\n</HEAD><BODY> \n\n<HR>\nThis e-mail message has been scanned for Viruses and Content and cleared\n<HR>\n</BODY></HTML>\n<br/>\n<p>Good Morning;</p>'
        );
        test.done();
    });
};

exports['Fail on HTML parser callstack error'] = test => {
    let mail = fs.readFileSync(__dirname + '/fixtures/htmllargecallstack.eml');

    test.expect(4);
    let mailparser = new MailParser();

    for (let i = 0, len = mail.length; i < len; i++) {
        mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.end();

    let mailobj = {};

    mailparser.on('data', data => {
        mailobj.text = data;
    });
    mailparser.on('error', err => {
        test.equal(err.name, 'Error');
        test.equal(err.message, 'Failed to parse HTML');
    });
    mailparser.on('end', () => {
        test.equal('Invalid HTML content', mailobj.text.text);
        test.equal(undefined, mailobj.text.html);
        test.done();
    });
};

exports['Base64 encoded root node'] = test => {
    let mail = fs.readFileSync(__dirname + '/fixtures/base64encodedroot.eml');

    test.expect(2);
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
        test.equal(1, attachments.length);

        const hash = crypto.createHash('sha256');
        hash.update(attachments[0].content);
        test.equal(hash.digest('hex'), '3d0c2d17edd1fed968f66ca200e7c165efd63834b488eec53deb24cca49c3d7b');
        test.done();
    });
};
exports['Out of memory error'] = test => {
    let mail = fs.readFileSync(__dirname + '/fixtures/outofmemory.eml');

    test.expect(4);
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
        test.equal(err.name, 'Error');
        test.equal(err.message, 'HTML too long for parsing 1139579 bytes');
    });
    mailparser.on('end', () => {
        test.equal('Invalid HTML content (too long)', mailobj.text.text);
        test.equal(undefined, mailobj.text.html);
        test.done();
    });
};

exports['Attachment partId'] = {
    'single part': test => {
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
            test.equal(attachments[0].partId, '1');
            test.done();
        });
    },
    'nested part': test => {
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
            test.equal(attachments[0].partId, '1.1');
            test.equal(attachments[1].partId, '1.2');
            test.equal(attachments[2].partId, '1.3');
            test.equal(attachments[3].partId, '2');
            test.done();
        });
    }
};

exports['Decoder already ended on cleanup'] = test => {
    let mail = fs.readFileSync(__dirname + '/fixtures/decoderended.eml');

    test.expect(1);
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
    });

    mailparser.on('end', () => {
        test.equal('\n\nNote: forwarded message attached.\n       \n---------------------------------\nBe a better something.\nCheck it out.', mailbodytext);
        test.done();
    });
};
