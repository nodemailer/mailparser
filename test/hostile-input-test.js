'use strict';

const simpleParser = require('..').simpleParser;
const MailParser = require('..').MailParser;
const { Readable } = require('stream');

// a 1x1 PNG, only the content type matters for cid: inlining
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function cidMessage(image, references) {
    return [
        'Content-Type: multipart/related; boundary=rel',
        'Subject: cid test',
        '',
        '--rel',
        'Content-Type: text/html',
        '',
        '<p>' + '<img src="cid:img1">'.repeat(references) + '</p>',
        '--rel',
        'Content-Type: image/png',
        'Content-ID: <img1>',
        'Content-Transfer-Encoding: base64',
        '',
        image.toString('base64').replace(/.{76}/g, '$&\r\n'),
        '--rel--',
        ''
    ].join('\r\n');
}

function countOf(str, needle) {
    return str.split(needle).length - 1;
}

module.exports['cid inlining'] = {
    'repeated references to a large image do not crash the process': test => {
        // 1500 references to a 300 KB image used to build a ~600 MB string from
        // inside setImmediate, a RangeError nothing could catch
        let image = Buffer.alloc(300 * 1024, 7);
        let start = Date.now();
        simpleParser(cidMessage(image, 1500), (err, mail) => {
            test.ifError(err);
            let dataUrlLength = ('data:image/png;base64,' + image.toString('base64')).length;
            let inlined = countOf(mail.html, 'data:image/png;base64,');
            test.ok(inlined >= 1, 'first references are inlined');
            test.equal(inlined, Math.floor((20 * 1024 * 1024) / dataUrlLength));
            test.equal(inlined + countOf(mail.html, 'cid:img1'), 1500);
            test.ok(Date.now() - start < 10000);
            test.done();
        });
    },

    'maxInlinedImagesSize caps inlined bytes': test => {
        let dataUrlLength = ('data:image/png;base64,' + PNG.toString('base64')).length;
        simpleParser(cidMessage(PNG, 5), { maxInlinedImagesSize: dataUrlLength * 2 + 1 }, (err, mail) => {
            test.ifError(err);
            test.equal(countOf(mail.html, 'data:image/png;base64,'), 2);
            test.equal(countOf(mail.html, 'cid:img1'), 3);
            test.done();
        });
    },

    'ordinary repeated references are all inlined': test => {
        simpleParser(cidMessage(PNG, 5), (err, mail) => {
            test.ifError(err);
            test.equal(countOf(mail.html, 'data:image/png;base64,'), 5);
            test.equal(countOf(mail.html, 'cid:'), 0);
            test.done();
        });
    },

    'a failing replacement is reported to the callback': test => {
        let parser = new MailParser();
        parser.on('data', data => {
            if (data.type === 'attachment') {
                data.content.on('data', () => false);
                data.content.on('end', () => data.release());
            }
        });
        parser.on('end', () => {
            // a value that throws when converted to a string stands in for a RangeError
            let url = {
                toString() {
                    throw new RangeError('Invalid string length');
                }
            };
            parser.updateImageLinks(
                (attachment, done) => done(null, url),
                (err, html) => {
                    test.ok(err instanceof RangeError);
                    test.equal(html, undefined);
                    test.done();
                }
            );
        });
        parser.end(Buffer.from(cidMessage(PNG, 1)));
    }
};

module.exports['Splitter errors after end of input'] = {
    'too many MIME nodes rejects': test => {
        let lines = ['Content-Type: multipart/mixed; boundary=b', 'Subject: parts', ''];
        for (let i = 0; i < 1100; i++) {
            lines.push('--b', 'Content-Type: text/plain', '', 'part' + i);
        }
        lines.push('--b--', '');
        simpleParser(lines.join('\r\n'))
            .then(mail => {
                test.ok(false, 'resolved with a truncated message ending in ' + JSON.stringify(mail.text.slice(-10)));
                test.done();
            })
            .catch(err => {
                test.equal(err.code, 'EMAXLEN');
                test.done();
            });
    },

    'oversized header block rejects': test => {
        let message = 'Subject: big\r\nX-Big: ' + 'a'.repeat(1100 * 1024) + '\r\n\r\nbody\r\n';
        simpleParser(Buffer.from(message))
            .then(() => {
                test.ok(false, 'resolved');
                test.done();
            })
            .catch(err => {
                test.equal(err.code, 'EMAXLEN');
                test.done();
            });
    }
};

module.exports['Encoded-word display name check is linear'] = test => {
    // "<a" followed by a long run of @ made /<[^<>]+@[^<>]+>/ backtrack quadratically
    let run = n => {
        let name = '=?utf-8?B?' + Buffer.from('<a' + '@'.repeat(n)).toString('base64') + '?=';
        let addresses = [{ name, address: '' }];
        let parser = new MailParser();
        let start = process.hrtime.bigint();
        parser.decodeAddresses(addresses);
        let elapsed = Number(process.hrtime.bigint() - start) / 1e6;
        test.equal(addresses.length, 1);
        test.equal(addresses[0].name, '<a' + '@'.repeat(n));
        return elapsed;
    };

    run(1000); // warm up
    let small = run(100000);
    let large = run(200000);
    test.ok(large < small * 3 + 50, `200k took ${large}ms, 100k took ${small}ms`);
    test.ok(large < 1000, `200k took ${large}ms`);

    // still re-parses a real bracketed address
    let addresses = [{ name: '=?utf-8?B?' + Buffer.from('Name <user@example.com>').toString('base64') + '?=', address: '' }];
    new MailParser().decodeAddresses(addresses);
    test.equal(addresses[0].address, 'user@example.com');
    test.done();
};

module.exports['simpleParser settles once on a non-fatal error'] = test => {
    let calls = [];
    let html = 'Content-Type: text/html\r\n\r\n<p>' + 'x'.repeat(200) + '</p>\r\n';
    simpleParser(html, { maxHtmlLengthToParse: 10 }, (err, mail) => {
        calls.push([err, mail]);
    });
    setTimeout(() => {
        test.equal(calls.length, 1);
        test.ok(calls[0][0] instanceof Error);
        test.ok(/HTML too long/.test(calls[0][0].message));
        test.done();
    }, 300);
};

module.exports['Attachment streams honour backpressure'] = test => {
    let content = Buffer.alloc(2 * 1024 * 1024);
    for (let i = 0; i < content.length; i++) {
        content[i] = (i * 31) % 256;
    }
    let message = Buffer.from(
        [
            'Content-Type: multipart/mixed; boundary=b',
            '',
            '--b',
            'Content-Type: application/octet-stream',
            'Content-Transfer-Encoding: base64',
            '',
            content.toString('base64').replace(/.{76}/g, '$&\r\n'),
            '--b--',
            ''
        ].join('\r\n')
    );
    // streamed in pieces, a single write hands the whole body over as one chunk
    let pieces = [];
    for (let i = 0; i < message.length; i += 16 * 1024) {
        pieces.push(message.subarray(i, i + 16 * 1024));
    }

    let parser = new MailParser();
    let buffered = -1;
    let received;
    parser.on('data', data => {
        if (data.type !== 'attachment') {
            return;
        }
        // do not read for a while, the parser must stop feeding the stream
        setTimeout(() => {
            buffered = data.content.writableLength;
            let chunks = [];
            data.content.on('data', chunk => chunks.push(chunk));
            data.content.on('end', () => {
                received = Buffer.concat(chunks);
                data.release();
            });
        }, 500);
    });
    parser.on('end', () => {
        // was the whole 2 MB attachment before
        test.ok(buffered >= 0 && buffered < 512 * 1024, 'buffered ' + buffered + ' bytes while paused');
        test.ok(received && received.equals(content), 'content is byte-identical');
        test.done();
    });
    Readable.from(pieces).pipe(parser);
};

module.exports['Attachment released without reading does not stall'] = test => {
    let message = Buffer.from(
        [
            'Content-Type: multipart/mixed; boundary=b',
            '',
            '--b',
            'Content-Type: application/octet-stream',
            'Content-Transfer-Encoding: base64',
            '',
            Buffer.alloc(1024 * 1024, 1)
                .toString('base64')
                .replace(/.{76}/g, '$&\r\n'),
            '--b',
            'Content-Type: text/plain',
            '',
            'after',
            '--b--',
            ''
        ].join('\r\n')
    );
    let pieces = [];
    for (let i = 0; i < message.length; i += 16 * 1024) {
        pieces.push(message.subarray(i, i + 16 * 1024));
    }

    let parser = new MailParser();
    let text;
    parser.on('data', data => {
        if (data.type === 'attachment') {
            // released once the stream is already backed up, the content is never read
            setTimeout(() => data.release(), 200);
        } else if (data.type === 'text') {
            text = data.text;
        }
    });
    parser.on('end', () => {
        test.equal(text, 'after');
        test.done();
    });
    Readable.from(pieces).pipe(parser);
};

module.exports['List-__proto__ header does not replace the prototype'] = test => {
    simpleParser(
        'List-__proto__: <mailto:a@example.com>\r\nList-Constructor: <mailto:b@example.com>\r\nList-Help: <mailto:help@example.com>\r\n\r\nx\r\n',
        (err, mail) => {
            test.ifError(err);
            let list = mail.headers.get('list');
            test.equal(Object.getPrototypeOf(list), Object.prototype);
            test.deepEqual(Object.keys(list), ['help']);
            test.equal(list.help.mail, 'help@example.com');
            test.done();
        }
    );
};

module.exports['partId follows the MIME tree for sibling multiparts'] = test => {
    let attachment = name => ['Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename="' + name + '"', '', name];
    let message = []
        .concat(
            ['Content-Type: multipart/mixed; boundary=m', '', '--m', 'Content-Type: multipart/related; boundary=r1', '', '--r1'],
            attachment('a'),
            ['--r1'],
            attachment('b'),
            ['--r1--', '', '--m', 'Content-Type: multipart/related; boundary=r2', '', '--r2'],
            attachment('c'),
            ['--r2--', '', '--m'],
            attachment('d'),
            ['--m--', '']
        )
        .join('\r\n');
    simpleParser(message, (err, mail) => {
        test.ifError(err);
        test.deepEqual(
            mail.attachments.map(a => a.filename + '=' + a.partId),
            ['a=1.1', 'b=1.2', 'c=2.1', 'd=3']
        );
        test.done();
    });
};

module.exports['EUC-JP bodies decode through iconv-lite'] = test => {
    // "nihongo" in EUC-JP
    let body = Buffer.from([0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec]);
    let message = Buffer.concat([Buffer.from('Content-Type: text/plain; charset=EUC-JP\r\nContent-Transfer-Encoding: 8bit\r\n\r\n'), body]);
    simpleParser(message, (err, mail) => {
        test.ifError(err);
        test.equal(mail.text, Buffer.from('e697a5e69cace8aa9e', 'hex').toString());
        simpleParser(Buffer.concat([Buffer.from('Content-Type: text/plain; charset=eucjp\r\n\r\n'), body]), (err, mail) => {
            test.ifError(err);
            test.equal(mail.text, Buffer.from('e697a5e69cace8aa9e', 'hex').toString());
            test.done();
        });
    });
};
