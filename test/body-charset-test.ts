import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import iconvModule from 'iconv';
import { MailParser, simpleParser } from '../src/index.js';
import { createRandom, PROPERTY_ITERATIONS, PROPERTY_SEED } from './helpers/random.js';
import type { Random } from './helpers/random.js';

const { Iconv } = iconvModule;

type TransferEncoding = '8bit' | 'base64' | 'quoted-printable';

function encodeBody(body: Buffer, encoding: TransferEncoding): Buffer {
    switch (encoding) {
        case 'base64':
            return Buffer.from(body.toString('base64').replace(/.{76}/g, '$&\r\n'));
        case 'quoted-printable': {
            let encoded = body.toString('latin1').replace(/[=\t \x80-\xff]/g, c => '=' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
            // soft line breaks, never inside an =XX escape
            return Buffer.from(encoded.replace(/[^\n]{60}[^=\n]{0,2}(?=[^\n])/g, '$&=\r\n'), 'latin1');
        }
        default:
            return body;
    }
}

function textMessage(charset: string, body: Buffer, contentType = 'text/plain', encoding: TransferEncoding = '8bit'): Buffer {
    return Buffer.concat([
        Buffer.from(`Content-Type: ${contentType}; charset=${charset}\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n`),
        encodeBody(body, encoding)
    ]);
}

// Writes the message into MailParser in chunks of the given sizes (cycled) and resolves with the
// text content it emits
function parseInChunks(message: Buffer, chunkSizes: number[] | ((offset: number) => number), options: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        let parser = new MailParser(options);
        let result: any = {};
        parser.on('data', (data: any) => {
            if (data.type === 'text') {
                result = data;
            }
            if (data.type === 'attachment') {
                data.content.resume();
                data.content.on('end', () => data.release());
            }
        });
        parser.on('error', reject);
        parser.on('end', () => resolve(result));

        let offset = 0;
        let index = 0;
        while (offset < message.length) {
            let size = typeof chunkSizes === 'function' ? chunkSizes(offset) : chunkSizes[index++ % chunkSizes.length]!;
            parser.write(message.subarray(offset, offset + size));
            offset += size;
        }
        parser.end();
    });
}

describe('Body charset decoding', () => {
    // The decoder gets the content in the pieces the transfer decoding produces, a base64 body in
    // runs of whole lines (57 bytes each). With iconv-lite 0.7.3's own decode stream a GB18030 four
    // byte character split across two such pieces lost the end of the text: the piece that finished
    // the character returned more than it had room for, and the excess was cut off
    it('decodes a base64 GB18030 body whose four byte character straddles a chunk boundary', async () => {
        let checks: Promise<void>[] = [];
        for (let prefix = 320; prefix <= 360; prefix++) {
            let text = 'x'.repeat(prefix) + '\u{20000} end';
            let message = textMessage('gb18030', iconv.encode(text, 'gb18030'), 'text/plain', 'base64');
            for (let chunkSizes of [[message.length], [1], [3, 5]]) {
                checks.push(
                    parseInChunks(message, chunkSizes).then(result => assert.equal(result.text, text, `prefix ${prefix}, chunks ${chunkSizes.join(',')}`))
                );
            }
        }
        await Promise.all(checks);
    });

    it('decodes a base64 GB18030 body whose stray lead byte ends a chunk', async () => {
        // a lead byte at the end of a piece, rejected by the space that starts the next one, lost the
        // last character of the text
        let checks: Promise<void>[] = [];
        for (let prefix = 320; prefix <= 360; prefix++) {
            let body = Buffer.concat([Buffer.from('x'.repeat(prefix)), Buffer.from([0x81]), Buffer.from(' end')]);
            checks.push(
                parseInChunks(textMessage('gb18030', body, 'text/plain', 'base64'), [7]).then(result =>
                    assert.equal(result.text, 'x'.repeat(prefix) + '\ufffd end', `prefix ${prefix}`)
                )
            );
        }
        await Promise.all(checks);
    });

    // Every character of these is two or four bytes long in its charset, so whatever piece size the
    // transfer decoding produces, characters straddle the boundaries
    let samples: Array<{ charset: string; text: string }> = [
        { charset: 'gb18030', text: '中文邮件正文，测试 GB18030 编码 \u{20000}\u{20001} 结束。' },
        { charset: 'big5', text: '繁體中文郵件內容 測試 Big5 編碼 結束。' },
        { charset: 'shift_jis', text: '日本語のメール本文 テスト Shift_JIS 終わり。' },
        { charset: 'euc-kr', text: '한국어 메일 본문 테스트 EUC-KR 끝.' },
        { charset: 'gbk', text: '简体中文 GBK 编码测试，结束。' }
    ];

    for (let { charset, text } of samples) {
        for (let encoding of ['8bit', 'base64', 'quoted-printable'] as const) {
            it(`decodes a ${encoding} ${charset} body written in small chunks`, async () => {
                let long = (text + ' ').repeat(40).trim();
                let message = textMessage(charset, iconv.encode(long, charset), 'text/plain', encoding);
                let results = await Promise.all([[1], [3], [2, 5, 1, 7]].map(chunkSizes => parseInChunks(message, chunkSizes)));
                for (let result of results) {
                    assert.equal(result.text, long);
                }
            });
        }
    }

    it('does not interpret a UTF-7 body', async () => {
        let body = Buffer.from('Hello +ADw-script+AD4-alert(1)+ADw-/script+AD4- there');
        let checks: Promise<void>[] = [];
        for (let contentType of ['text/plain', 'text/html']) {
            for (let charset of ['utf-7', 'UTF7', 'unicode-1-1-utf-7', 'utf-7-imap']) {
                checks.push(
                    simpleParser(textMessage(charset, body, contentType)).then((mail: any) => {
                        let content = contentType === 'text/html' ? mail.html : mail.text;
                        assert.ok(!/<script/i.test(content), `${charset} ${contentType}: ${content}`);
                        assert.ok(content.includes('+ADw-script+AD4-'), `${charset} ${contentType} keeps the bytes as they are`);
                    })
                );
            }
        }
        await Promise.all(checks);
    });

    it('does not interpret a UTF-7 body with the native Iconv option', async () => {
        let body = Buffer.from('Hello +ADw-script+AD4-alert(1)+ADw-/script+AD4- there');
        let mail: any = await simpleParser(textMessage('utf-7', body, 'text/html'), { Iconv });
        assert.ok(!/<script/i.test(mail.html), mail.html);
        assert.ok(mail.html.includes('+ADw-script+AD4-'));
    });

    it('decodes a body in an unknown charset as UTF-8', async () => {
        let mail: any = await simpleParser(textMessage('x-no-such-charset', Buffer.from('café \xff end', 'latin1')));
        assert.equal(mail.text, 'caf\ufffd \ufffd end');
        mail = await simpleParser(textMessage('x-no-such-charset', Buffer.from('café ok')));
        assert.equal(mail.text, 'café ok');
    });

    it('decodes an ISO-2022-JP body written in small chunks', async () => {
        let expected = '学校技術員研修検討会報告';
        let body = Buffer.from('GyRCM1g5OzU7PVEwdzgmPSQ4IUYkMnFKczlwGyhC', 'base64');
        let results = await Promise.all([[1], [2, 3], [1000]].map(chunkSizes => parseInChunks(textMessage('ISO-2022-JP', body), chunkSizes)));
        for (let result of results) {
            assert.equal(result.text, expected);
        }
    });

    it('decodes a UTF-16 body without a BOM the same way in chunks as at once', async () => {
        let text = 'Plain ASCII heavy text body, mostly Latin, ' + 'x'.repeat(40);
        let body = iconv.encode(text, 'utf-16be');
        let result = await parseInChunks(textMessage('utf-16', body), [5]);
        assert.equal(result.text, iconv.decode(body, 'utf-16'));
    });
});

describe('Body charset decoding properties', () => {
    // characters with one, two, three and four byte encodings in the charsets below, plus line
    // breaks and the ASCII punctuation the double byte decoders cut at
    const ALPHABETS: Record<string, string> = {
        gb18030: 'abc XYZ 019,.;:!?\n中文邮件测试编码结束简体汉字€£¥©®°±²³µ¶·¼½¾ÀÉÖÜßàéöü𠀀𠀁𠀂\u{1F600}\u{1F603}',
        gbk: 'abc XYZ 019,.;:!?\n中文邮件测试编码结束简体汉字',
        big5: 'abc XYZ 019,.;:!?\n繁體中文郵件內容測試編碼結束',
        shift_jis: 'abc XYZ 019,.;:!?\n日本語のメール本文テスト終わりカタカナひらがな漢字',
        'euc-jp': 'abc XYZ 019,.;:!?\n日本語のメール本文テスト終わりカタカナひらがな漢字',
        'euc-kr': 'abc XYZ 019,.;:!?\n한국어메일본문테스트끝',
        'iso-8859-1': 'abc XYZ 019,.;:!?\nàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ',
        'windows-1251': 'abc XYZ 019,.;:!?\nабвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВ',
        'utf-8': 'abc XYZ 019,.;:!?\nõäöü中文𠀀\u{1F600}한국어',
        'utf-16le': 'abc XYZ 019,.;:!?\nõäöü中文𠀀\u{1F600}한국어'
    };

    function randomText(random: Random, alphabet: string): string {
        return random.string(alphabet, random.int(1, 1200));
    }

    function randomChunker(random: Random) {
        let max = random.pick([1, 2, 3, 7, 64]);
        return () => random.int(1, max);
    }

    for (let charset of Object.keys(ALPHABETS)) {
        it(`random ${charset} bodies decode the same in random chunks as at once`, async () => {
            let checks: Promise<void>[] = [];
            for (let seed = 1; seed <= PROPERTY_ITERATIONS; seed++) {
                let random = createRandom(PROPERTY_SEED + seed * 7919 + charset.length);
                let text = randomText(random, ALPHABETS[charset]!);
                let body = iconv.encode(text, charset);
                let encoding = random.pick(['8bit', 'base64', 'quoted-printable'] as const);
                let message = textMessage(charset, body, 'text/plain', encoding);
                // the one-shot decode, with the line endings normalized the way the parser does
                let expected = iconv.decode(body, charset).replace(/\r?\n/g, '\n');
                let at = `${charset} ${encoding} case ${seed} (PROPERTY_SEED=${PROPERTY_SEED})`;

                checks.push(
                    Promise.all([parseInChunks(message, [message.length]), parseInChunks(message, randomChunker(random))]).then(([oneShot, chunked]) => {
                        assert.equal(oneShot.text, expected, `${at} at once`);
                        assert.equal(chunked.text, expected, `${at} in chunks`);
                    })
                );
            }
            await Promise.all(checks);
        });
    }
});
