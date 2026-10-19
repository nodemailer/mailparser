import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { execFile, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// These tests exercise the compiled output in dist/ (built by the pretest script) through the
// package.json exports map, the same way an installed copy of the package is loaded. Node
// resolves the package name to the package itself when the specifier is used from inside it.
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsc = require.resolve('typescript/bin/tsc');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// A non-literal specifier keeps TypeScript from resolving the built types at type-check time,
// when dist/ may not exist yet
const packageName: string = 'mailparser';

// Every path that resolved before the TypeScript build, when the package had no exports map
const LEGACY_PATHS = [
    '',
    '/index',
    '/index.js',
    '/lib/mail-parser',
    '/lib/mail-parser.js',
    '/lib/simple-parser',
    '/lib/simple-parser.js',
    '/lib/stream-hash',
    '/lib/stream-hash.js'
];

const MESSAGE = 'From: Sender <sender@example.com>\r\nSubject: Hello\r\nContent-Type: text/html\r\n\r\n<p>Hello <b>world</b> https://example.com</p>';

const hasDist = fs.existsSync(path.join(root, 'dist', 'cjs', 'index.js')) && fs.existsSync(path.join(root, 'dist', 'esm', 'index.js'));

describe('Built package', { timeout: 120 * 1000, skip: hasDist ? false : 'dist/ is not built, run npm run build first' }, () => {
    it('ships both module formats with type declarations', () => {
        for (const format of ['esm', 'cjs']) {
            for (const file of ['index', 'mail-parser', 'simple-parser', 'stream-hash']) {
                assert.ok(fs.existsSync(path.join(root, 'dist', format, file + '.js')), `${format}/${file}.js`);
                assert.ok(fs.existsSync(path.join(root, 'dist', format, file + '.d.ts')), `${format}/${file}.d.ts`);
            }
            assert.ok(fs.existsSync(path.join(root, 'dist', format, 'tlds.cjs')), `${format}/tlds.cjs`);
        }
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'dist', 'esm', 'package.json'), 'utf8')), { type: 'module' });
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'dist', 'cjs', 'package.json'), 'utf8')), { type: 'commonjs' });
    });

    it('points every package.json entry at an existing file', () => {
        assert.equal(pkg.main, './dist/cjs/index.js');
        assert.ok(fs.existsSync(path.join(root, pkg.types)), 'types entry exists');
        for (const [subpath, target] of Object.entries(pkg.exports as Record<string, string | { import: string; require: string }>)) {
            const targets = typeof target === 'string' ? [target] : [target.import, target.require];
            for (const file of targets) {
                assert.ok(fs.existsSync(path.join(root, file)), `${subpath} -> ${file}`);
            }
        }
        for (const subpath of LEGACY_PATHS) {
            assert.ok(pkg.exports['.' + subpath], `${subpath || '.'} is exported`);
        }
    });

    it('packs the build and leaves the sources and tests out', () => {
        // --ignore-scripts: prepare would rebuild dist/ under the running suite
        const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const files: string[] = JSON.parse(result.stdout)[0].files.map((file: { path: string }) => file.path);
        for (const required of [
            'package.json',
            'README.md',
            'LICENSE',
            'dist/cjs/index.js',
            'dist/cjs/index.d.ts',
            'dist/cjs/mail-parser.js',
            'dist/cjs/tlds.cjs',
            'dist/cjs/package.json',
            'dist/esm/index.js',
            'dist/esm/tlds.cjs',
            'dist/esm/package.json'
        ]) {
            assert.ok(files.includes(required), `${required} is packed`);
        }
        for (const file of files) {
            assert.ok(!/^(src|test|scripts|bench|examples|coverage)\//.test(file), `${file} must not be packed`);
        }
    });

    describe('CommonJS build', () => {
        it('resolves require() to the CommonJS entry point', () => {
            assert.equal(require.resolve(packageName), path.join(root, 'dist', 'cjs', 'index.js'));
        });

        it('keeps the shape of the pre-TypeScript module', () => {
            const mailparser = require(packageName);
            assert.deepEqual(Object.keys(mailparser), ['MailParser', 'simpleParser']);
            assert.equal(typeof mailparser.simpleParser, 'function');
            assert.equal(mailparser.simpleParser.length, 3);
            assert.equal(Object.getPrototypeOf(mailparser.MailParser.prototype), Transform.prototype);
            // the default alias points at the module itself and stays out of the enumerable keys
            assert.equal(mailparser.default, mailparser);
        });

        it('resolves every legacy path to the same values', () => {
            const mailparser = require(packageName);
            for (const subpath of ['', '/index', '/index.js']) {
                assert.equal(require(packageName + subpath), mailparser, subpath);
            }
            for (const suffix of ['', '.js']) {
                assert.equal(require(packageName + '/lib/mail-parser' + suffix), mailparser.MailParser);
                assert.equal(require(packageName + '/lib/simple-parser' + suffix), mailparser.simpleParser);
                const StreamHash = require(packageName + '/lib/stream-hash' + suffix);
                assert.equal(typeof StreamHash, 'function');
                assert.deepEqual(Object.keys(StreamHash), []);
                assert.equal(StreamHash.default, StreamHash);
            }
        });

        it('parses a message', async () => {
            const mail = await require(packageName).simpleParser(MESSAGE);
            assert.equal(mail.subject, 'Hello');
            assert.equal(mail.text, 'Hello world https://example.com');
        });
    });

    describe('ES module build', () => {
        it('resolves import to the ES module entry point', async () => {
            const direct = await import(new URL('../../dist/esm/index.js', import.meta.url).href);
            const byName = await import(packageName);
            assert.equal(byName.simpleParser, direct.simpleParser);
            assert.equal(byName.MailParser, direct.MailParser);
        });

        it('exposes named and default exports, and the deep paths', async () => {
            const mailparser = await import(packageName);
            assert.equal(typeof mailparser.simpleParser, 'function');
            assert.equal(mailparser.default.simpleParser, mailparser.simpleParser);
            assert.equal(mailparser.default.MailParser, mailparser.MailParser);
            const load = (subpath: string) => import(packageName + subpath);
            const [index, indexJs, mailParser, mailParserJs, simpleParser, simpleParserJs, streamHash, streamHashJs] = await Promise.all(
                [
                    '/index',
                    '/index.js',
                    '/lib/mail-parser',
                    '/lib/mail-parser.js',
                    '/lib/simple-parser',
                    '/lib/simple-parser.js',
                    '/lib/stream-hash',
                    '/lib/stream-hash.js'
                ].map(load)
            );
            assert.equal(index.simpleParser, mailparser.simpleParser);
            assert.equal(indexJs.simpleParser, mailparser.simpleParser);
            assert.equal(mailParser.default, mailparser.MailParser);
            assert.equal(mailParserJs.default, mailparser.MailParser);
            assert.equal(simpleParser.default, mailparser.simpleParser);
            assert.equal(simpleParserJs.default, mailparser.simpleParser);
            assert.equal(typeof streamHash.default, 'function');
            assert.equal(streamHashJs.default, streamHash.default);
        });

        it('parses a message the same way as the CommonJS build', async () => {
            const { simpleParser } = await import(packageName);
            const esm = await simpleParser(MESSAGE);
            const cjs = await require(packageName).simpleParser(MESSAGE);
            assert.deepEqual({ ...esm, headers: [...esm.headers] }, { ...cjs, headers: [...cjs.headers] });
        });
    });

    // each tsc run has its own temporary project, so they run side by side
    describe('type declarations', { concurrency: true }, () => {
        it('keep the internals and the untyped dependencies out', () => {
            for (const format of ['esm', 'cjs']) {
                const declarations = ['index', 'mail-parser', 'simple-parser', 'types']
                    .map(file => fs.readFileSync(path.join(root, 'dist', format, file + '.d.ts'), 'utf8'))
                    .join('\n');
                for (const hidden of ['processChunk', 'ParserNode', 'attachmentList', 'linkify', "'he'", 'html-to-text', 'punycode.js', 'tlds']) {
                    assert.ok(!declarations.includes(hidden), `${format} declares ${hidden}`);
                }
            }
        });

        const esmConsumer = `
import { simpleParser, MailParser } from 'mailparser';
import mailparser from 'mailparser';
import type { AddressObject, Attachment, AttachmentStream, HeaderValue, MessageText, ParsedMail, SimpleParserOptions } from 'mailparser';

export async function run(source: Buffer): Promise<string[]> {
    const options: SimpleParserOptions = { keepCidLinks: true, skipTextLinks: true, checksumAlgo: 'sha256', formatDateString: date => date.toISOString() };
    const mail: ParsedMail = await simpleParser(source, options);
    const other = await mailparser.simpleParser(source.toString());
    const from: AddressObject | undefined = mail.from;
    const html: string | false | undefined = other.html;
    const attachments: Attachment[] = mail.attachments;
    const content: Buffer = attachments[0]!.content;
    const subject: HeaderValue | undefined = mail.headers.get('subject');
    simpleParser(source, (err: Error | null, parsed: ParsedMail) => void [err, parsed.subject]);

    const parser = new MailParser({ skipHtmlToText: true });
    parser.on('headers', headers => void headers.get('date'));
    parser.on('data', (data: AttachmentStream | MessageText) => {
        if (data.type === 'attachment') {
            data.content.resume();
            data.content.on('end', () => data.release?.());
        } else {
            void data.textAsHtml;
        }
    });
    parser.end(source);
    void [from, html, content, subject];
    return attachments.map(attachment => attachment.checksum);
}
`;

        const cjsConsumer = `
import mailparser = require('mailparser');

export async function run(source: Buffer): Promise<string | undefined> {
    const parser: mailparser.MailParser = new mailparser.MailParser();
    parser.end(source);
    const mail: mailparser.ParsedMail = await mailparser.simpleParser(source);
    return mail.subject;
}
`;

        const deepConsumer = `
import MailParser from 'mailparser/lib/mail-parser.js';
import simpleParser from 'mailparser/lib/simple-parser.js';

export async function run(source: Buffer): Promise<string | undefined> {
    new MailParser().end(source);
    return (await simpleParser(source)).messageId;
}
`;

        const internalConsumer = `
import { MailParser } from 'mailparser';
new MailParser().processChunk({}, () => {});
`;

        // Type-checks a consumer against the built declarations the way an installed copy is
        // resolved: the package is linked into a temporary project, so the specifier goes
        // through the package.json exports map
        const typeCheck = async (source: string, compilerOptions: Record<string, unknown>, type?: string): Promise<{ status: number; output: string }> => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailparser-types-'));
            try {
                fs.mkdirSync(path.join(dir, 'node_modules', '@types'), { recursive: true });
                fs.symlinkSync(root, path.join(dir, 'node_modules', 'mailparser'), 'dir');
                fs.symlinkSync(path.join(root, 'node_modules', '@types', 'node'), path.join(dir, 'node_modules', '@types', 'node'), 'dir');
                fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, ...(type ? { type } : {}) }));
                fs.writeFileSync(path.join(dir, 'consumer.ts'), source);
                fs.writeFileSync(
                    path.join(dir, 'tsconfig.json'),
                    JSON.stringify({
                        compilerOptions: {
                            target: 'ES2022',
                            lib: ['ES2023'],
                            types: ['node'],
                            strict: true,
                            exactOptionalPropertyTypes: true,
                            skipLibCheck: false,
                            noEmit: true,
                            ...compilerOptions
                        },
                        include: ['consumer.ts']
                    })
                );
                return await new Promise(resolve => {
                    execFile(process.execPath, [tsc, '-p', path.join(dir, 'tsconfig.json')], (err, stdout, stderr) =>
                        resolve({ status: err ? Number(err.code) || 1 : 0, output: stdout + stderr })
                    );
                });
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        };

        const node16 = { module: 'node16', moduleResolution: 'node16' };

        for (const [label, options, type] of [
            ['a node16 ES module project', node16, 'module'],
            ['a node16 CommonJS project', node16, undefined],
            ['bundler resolution', { module: 'esnext', moduleResolution: 'bundler' }, 'module']
        ] as const) {
            it(`type-check an ES module style consumer in ${label}`, async () => {
                const { status, output } = await typeCheck(esmConsumer, { ...options, esModuleInterop: true }, type);
                assert.equal(status, 0, output);
            });

            it(`type-check deep imports in ${label}`, async () => {
                const { status, output } = await typeCheck(deepConsumer, { ...options, esModuleInterop: true }, type);
                assert.equal(status, 0, output);
            });
        }

        it('type-check a CommonJS consumer', async () => {
            const { status, output } = await typeCheck(cjsConsumer, node16);
            assert.equal(status, 0, output);
        });

        // node10 resolution ignores the exports map, the deep paths resolve through typesVersions
        it('type-check consumers with the legacy node10 resolution', async () => {
            const node10 = { module: 'commonjs', moduleResolution: 'node10', ignoreDeprecations: '6.0', esModuleInterop: true };
            const results = await Promise.all([cjsConsumer, deepConsumer, deepConsumer.replace(/\.js'/g, "'")].map(source => typeCheck(source, node10)));
            for (const { status, output } of results) {
                assert.equal(status, 0, output);
            }
        });

        it('do not let a consumer reach the internals', async () => {
            const { status, output } = await typeCheck(internalConsumer, node16, 'module');
            assert.notEqual(status, 0);
            assert.match(output, /Property 'processChunk' does not exist/);
        });
    });
});
