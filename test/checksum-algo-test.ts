import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { MailParser, simpleParser } from '../src/index.js';
import StreamHash from '../src/stream-hash.js';

const CONTENT = Buffer.from([0, 1, 2, 3, 4, 5, 6]);

const MESSAGE = Buffer.from(
    [
        'Content-Type: multipart/mixed; boundary=ABC',
        '',
        '--ABC',
        'Content-Type: text/plain',
        '',
        'Hello',
        '--ABC',
        'Content-Type: application/octet-stream',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="a.bin"',
        '',
        CONTENT.toString('base64'),
        '--ABC',
        'Content-Type: image/png',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: inline',
        'Content-ID: <img>',
        '',
        CONTENT.toString('base64'),
        '--ABC--',
        ''
    ].join('\r\n')
);

describe('checksumAlgo: false', () => {
    it('leaves checksum unset on simpleParser attachments and still sets the size', async (t: TestContext) => {
        let createHash = t.mock.method(crypto, 'createHash');
        let mail: any = await simpleParser(MESSAGE, { checksumAlgo: false });
        assert.equal(mail.attachments.length, 2);
        for (let attachment of mail.attachments) {
            assert.ok(!('checksum' in attachment), 'checksum is not set');
            assert.equal(attachment.size, CONTENT.length);
            assert.deepEqual(attachment.content, CONTENT);
        }
        assert.equal(mail.text.trim(), 'Hello');
        assert.equal(createHash.mock.callCount(), 0, 'nothing is hashed');
    });

    it('leaves checksum unset on streamed attachments', (t: TestContext, done) => {
        let parser = new MailParser({ checksumAlgo: false });
        let attachments: any[] = [];
        parser.on('data', (data: any) => {
            if (data.type === 'attachment') {
                let chunks: Buffer[] = [];
                data.content.on('data', (chunk: Buffer) => chunks.push(chunk));
                data.content.on('end', () => {
                    t.assert.deepStrictEqual(Buffer.concat(chunks), CONTENT);
                    attachments.push(data);
                    data.release();
                });
            }
        });
        parser.on('end', () => {
            t.assert.strictEqual(attachments.length, 2);
            for (let attachment of attachments) {
                t.assert.strictEqual(attachment.checksum, undefined);
                t.assert.strictEqual(attachment.size, CONTENT.length);
            }
            done();
        });
        parser.end(MESSAGE);
    });

    it('keeps md5 as the default, and an empty value means the default', async () => {
        let md5 = crypto.createHash('md5').update(CONTENT).digest('hex');
        let results: any[] = await Promise.all([{}, { checksumAlgo: '' }, { checksumAlgo: undefined }].map(options => simpleParser(MESSAGE, options as any)));
        for (let mail of results) {
            assert.deepEqual(
                mail.attachments.map((a: any) => a.checksum),
                [md5, md5]
            );
        }
        let mail: any = await simpleParser(MESSAGE, { checksumAlgo: 'sha256' });
        assert.equal(mail.attachments[0].checksum, crypto.createHash('sha256').update(CONTENT).digest('hex'));
    });

    it('makes StreamHash record only the size', async () => {
        let target: { checksum?: string; size?: number } = {};
        let hasher = new StreamHash(target, false);
        assert.equal(hasher.hash, null);
        hasher.resume();
        await new Promise(resolve => {
            hasher.on('end', resolve);
            hasher.end(CONTENT);
        });
        assert.deepEqual(target, { size: CONTENT.length });
    });
});
