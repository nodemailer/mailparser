import { describe, it, test } from 'node:test';
import type { TestContext } from 'node:test';
import { simpleParser, MailParser } from '../src/index.js';
import { Readable } from 'node:stream';

// a 1x1 PNG, only the content type matters for cid: inlining
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function cidMessage(image: Buffer, references: number) {
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

function countOf(str: string, needle: string) {
    return str.split(needle).length - 1;
}

describe('cid inlining', () => {
    it('repeated references to a large image do not crash the process', (t: TestContext, done) => {
        // 1500 references to a 300 KB image used to build a ~600 MB string from
        // inside setImmediate, a RangeError nothing could catch
        let image = Buffer.alloc(300 * 1024, 7);
        let start = Date.now();
        simpleParser(cidMessage(image, 1500), (err, mail: any) => {
            t.assert.ifError(err);
            let dataUrlLength = ('data:image/png;base64,' + image.toString('base64')).length;
            let inlined = countOf(mail.html, 'data:image/png;base64,');
            t.assert.ok(inlined >= 1, 'first references are inlined');
            t.assert.strictEqual(inlined, Math.floor((20 * 1024 * 1024) / dataUrlLength));
            t.assert.strictEqual(inlined + countOf(mail.html, 'cid:img1'), 1500);
            t.assert.ok(Date.now() - start < 10000);
            done();
        });
    });

    it('maxInlinedImagesSize caps inlined bytes', (t: TestContext, done) => {
        let dataUrlLength = ('data:image/png;base64,' + PNG.toString('base64')).length;
        simpleParser(cidMessage(PNG, 5), { maxInlinedImagesSize: dataUrlLength * 2 + 1 }, (err, mail: any) => {
            t.assert.ifError(err);
            t.assert.strictEqual(countOf(mail.html, 'data:image/png;base64,'), 2);
            t.assert.strictEqual(countOf(mail.html, 'cid:img1'), 3);
            done();
        });
    });

    it('ordinary repeated references are all inlined', (t: TestContext, done) => {
        simpleParser(cidMessage(PNG, 5), (err, mail: any) => {
            t.assert.ifError(err);
            t.assert.strictEqual(countOf(mail.html, 'data:image/png;base64,'), 5);
            t.assert.strictEqual(countOf(mail.html, 'cid:'), 0);
            done();
        });
    });

    it('a failing replacement is reported to the callback', (t: TestContext, done) => {
        let parser: any = new MailParser();
        parser.on('data', (data: any) => {
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
                (attachment: unknown, done: (err: null, url: unknown) => void) => done(null, url),
                (err: unknown, html: unknown) => {
                    t.assert.ok(err instanceof RangeError);
                    t.assert.strictEqual(html, undefined);
                    done();
                }
            );
        });
        parser.end(Buffer.from(cidMessage(PNG, 1)));
    });
});

describe('Splitter errors after end of input', () => {
    it('too many MIME nodes rejects', (t: TestContext, done) => {
        let lines = ['Content-Type: multipart/mixed; boundary=b', 'Subject: parts', ''];
        for (let i = 0; i < 1100; i++) {
            lines.push('--b', 'Content-Type: text/plain', '', 'part' + i);
        }
        lines.push('--b--', '');
        simpleParser(lines.join('\r\n'))
            .then((mail: any) => {
                t.assert.ok(false, 'resolved with a truncated message ending in ' + JSON.stringify(mail.text.slice(-10)));
                done();
            })
            .catch(err => {
                t.assert.strictEqual(err.code, 'EMAXLEN');
                done();
            });
    });

    it('oversized header block rejects', (t: TestContext, done) => {
        let message = 'Subject: big\r\nX-Big: ' + 'a'.repeat(1100 * 1024) + '\r\n\r\nbody\r\n';
        simpleParser(Buffer.from(message))
            .then(() => {
                t.assert.ok(false, 'resolved');
                done();
            })
            .catch(err => {
                t.assert.strictEqual(err.code, 'EMAXLEN');
                done();
            });
    });
});

test('Encoded-word display name check is linear', (t: TestContext, done) => {
    // "<a" followed by a long run of @ once made a bracketed-address regex backtrack quadratically
    let run = (n: number) => {
        let name = '=?utf-8?B?' + Buffer.from('<a' + '@'.repeat(n)).toString('base64') + '?=';
        let addresses = [{ name, address: '' }];
        let parser: any = new MailParser();
        let start = process.hrtime.bigint();
        parser.decodeAddresses(addresses);
        let elapsed = Number(process.hrtime.bigint() - start) / 1e6;
        t.assert.strictEqual(addresses.length, 1);
        t.assert.strictEqual(addresses[0].name, '<a' + '@'.repeat(n));
        return elapsed;
    };

    run(1000); // warm up
    let small = run(100000);
    let large = run(200000);
    t.assert.ok(large < small * 3 + 50, `200k took ${large}ms, 100k took ${small}ms`);
    t.assert.ok(large < 1000, `200k took ${large}ms`);

    // a decoded bracketed address stays a display name, it is never parsed as an address
    let addresses = [{ name: '=?utf-8?B?' + Buffer.from('Name <user@example.com>').toString('base64') + '?=', address: '' }];
    new MailParser().decodeAddresses(addresses);
    t.assert.strictEqual(addresses[0].address, '');
    t.assert.strictEqual(addresses[0].name, 'Name <user@example.com>');
    done();
});

test('HTML too long to convert yields empty text and keeps the HTML', (t: TestContext, done) => {
    let calls: any[] = [];
    let html = '<p>' + 'x'.repeat(200) + '</p>\n';
    simpleParser('Content-Type: text/html\r\n\r\n' + html, { maxHtmlLengthToParse: 10 }, (err, mail: any) => {
        calls.push([err, mail]);
    });
    setTimeout(() => {
        // used to be reported as an 'error' event, which rejected the whole message
        t.assert.strictEqual(calls.length, 1);
        t.assert.ifError(calls[0][0]);
        let mail = calls[0][1];
        t.assert.strictEqual(mail.text, '');
        t.assert.strictEqual(mail.html, html);
        t.assert.ok(mail.textConversionError instanceof Error);
        t.assert.ok(/HTML too long/.test(mail.textConversionError.message));
        done();
    }, 300);
});

test('Deeply nested HTML is not converted to text but the message still parses', (t: TestContext, done) => {
    // 200k nested <b> made html-to-text throw after several seconds, and the 'error'
    // event rejected the message without its text, headers or attachments
    let html = '<b>'.repeat(200000) + 'deep' + '</b>'.repeat(200000);
    let message = [
        'Subject: nested',
        'Content-Type: multipart/mixed; boundary=m',
        '',
        '--m',
        'Content-Type: text/plain',
        '',
        'plain part',
        '--m',
        'Content-Type: text/html',
        '',
        html,
        '--m',
        'Content-Type: application/pdf; name=a.pdf',
        'Content-Disposition: attachment; filename=a.pdf',
        'Content-Transfer-Encoding: base64',
        '',
        'JVBERi0=',
        '--m--',
        ''
    ].join('\r\n');
    let start = Date.now();
    simpleParser(message, (err, mail: any) => {
        t.assert.ifError(err);
        let elapsed = Date.now() - start;
        t.assert.ok(elapsed < 2000, `took ${elapsed}ms`);
        t.assert.strictEqual(mail.subject, 'nested');
        t.assert.strictEqual(mail.text, 'plain part\n');
        t.assert.ok(mail.html.includes(html));
        t.assert.strictEqual(mail.attachments.length, 1);
        t.assert.strictEqual(mail.attachments[0].filename, 'a.pdf');
        t.assert.ok(mail.textConversionError instanceof Error);
        t.assert.ok(/nested deeper/.test(mail.textConversionError.message));

        // a root HTML message gets an empty text instead
        simpleParser('Content-Type: text/html\r\n\r\n' + html, (err, mail: any) => {
            t.assert.ifError(err);
            t.assert.strictEqual(mail.text, '');
            t.assert.strictEqual(mail.html, html);
            t.assert.ok(mail.textConversionError instanceof Error);

            // sloppy markup with thousands of unclosed cells is not deep, so it still converts
            let cells = '<table><tr>' + '<td>cell'.repeat(3000) + '</table>';
            simpleParser('Content-Type: text/html\r\n\r\n' + cells, (err, mail: any) => {
                t.assert.ifError(err);
                t.assert.ok(!mail.textConversionError);
                t.assert.ok(mail.text.includes('cell'));
                done();
            });
        });
    });
});

test('Repeated References headers are collected in linear time', (t: TestContext, done) => {
    // rebuilding the list with concat for every header took 1.8 s for 65k References lines
    let run = (n: number) => {
        let lines = [];
        for (let i = 0; i < n; i++) {
            lines.push({ key: 'references', line: `References: <${i}@example.com>` });
        }
        let parser: any = new MailParser();
        let best = Infinity;
        for (let i = 0; i < 3; i++) {
            let start = process.hrtime.bigint();
            let headers: any = parser.processHeaders(lines);
            best = Math.min(best, Number(process.hrtime.bigint() - start) / 1e6);
            t.assert.strictEqual(headers.get('references').length, n);
        }
        return best;
    };

    run(1000); // warm up
    let small = run(12500);
    let large = run(50000);
    // quadrupling the input costs a linear implementation about 4x and a quadratic one about 16x
    t.assert.ok(large < small * 6 + 50, `50k took ${large}ms, 12.5k took ${small}ms`);
    t.assert.ok(large < 1000, `50k took ${large}ms`);
    done();
});

test('Attachment streams honour backpressure', (t: TestContext, done) => {
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

    let parser: any = new MailParser();
    let buffered = -1;
    let received: Buffer | undefined;
    parser.on('data', (data: any) => {
        if (data.type !== 'attachment') {
            return;
        }
        // do not read for a while, the parser must stop feeding the stream
        setTimeout(() => {
            buffered = data.content.writableLength;
            let chunks: Buffer[] = [];
            data.content.on('data', (chunk: Buffer) => chunks.push(chunk));
            data.content.on('end', () => {
                received = Buffer.concat(chunks);
                data.release();
            });
        }, 500);
    });
    parser.on('end', () => {
        // was the whole 2 MB attachment before
        t.assert.ok(buffered >= 0 && buffered < 512 * 1024, 'buffered ' + buffered + ' bytes while paused');
        t.assert.ok(received && received.equals(content), 'content is byte-identical');
        done();
    });
    Readable.from(pieces).pipe(parser);
});

test('Attachment released without reading does not stall', (t: TestContext, done) => {
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

    let parser: any = new MailParser();
    let text: string | undefined;
    parser.on('data', (data: any) => {
        if (data.type === 'attachment') {
            // released once the stream is already backed up, the content is never read
            setTimeout(() => data.release(), 200);
        } else if (data.type === 'text') {
            text = data.text;
        }
    });
    parser.on('end', () => {
        t.assert.strictEqual(text, 'after');
        done();
    });
    Readable.from(pieces).pipe(parser);
});

test('List-__proto__ header does not replace the prototype', (t: TestContext, done) => {
    simpleParser(
        'List-__proto__: <mailto:a@example.com>\r\nList-Constructor: <mailto:b@example.com>\r\nList-Help: <mailto:help@example.com>\r\n\r\nx\r\n',
        (err, mail: any) => {
            t.assert.ifError(err);
            let list = mail.headers.get('list');
            t.assert.strictEqual(Object.getPrototypeOf(list), Object.prototype);
            t.assert.deepStrictEqual(Object.keys(list), ['help']);
            t.assert.strictEqual(list.help.mail, 'help@example.com');
            done();
        }
    );
});

test('partId follows the MIME tree for sibling multiparts', (t: TestContext, done) => {
    let attachment = (name: string) => ['Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename="' + name + '"', '', name];
    let message = ([] as string[])
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
    simpleParser(message, (err, mail: any) => {
        t.assert.ifError(err);
        t.assert.deepStrictEqual(
            mail.attachments.map((a: any) => a.filename + '=' + a.partId),
            ['a=1.1', 'b=1.2', 'c=2.1', 'd=3']
        );
        done();
    });
});

test('EUC-JP bodies decode through iconv-lite', (t: TestContext, done) => {
    // "nihongo" in EUC-JP
    let body = Buffer.from([0xc6, 0xfc, 0xcb, 0xdc, 0xb8, 0xec]);
    let message = Buffer.concat([Buffer.from('Content-Type: text/plain; charset=EUC-JP\r\nContent-Transfer-Encoding: 8bit\r\n\r\n'), body]);
    simpleParser(message, (err, mail: any) => {
        t.assert.ifError(err);
        t.assert.strictEqual(mail.text, Buffer.from('e697a5e69cace8aa9e', 'hex').toString());
        simpleParser(Buffer.concat([Buffer.from('Content-Type: text/plain; charset=eucjp\r\n\r\n'), body]), (err, mail: any) => {
            t.assert.ifError(err);
            t.assert.strictEqual(mail.text, Buffer.from('e697a5e69cace8aa9e', 'hex').toString());
            done();
        });
    });
});
