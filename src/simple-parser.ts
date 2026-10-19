import MailParser from './mail-parser.js';
import type { Attachment, AttachmentStream, ParsedMail, SimpleParserOptions, Source } from './types.js';

/**
 * Called with the parsed message, or with the error that stopped parsing.
 */
export type SimpleParserCallback = (err: Error | null, mail: ParsedMail) => void;

/**
 * Parses a whole message into one object, attachments buffered in memory. Resolves with the
 * parsed message, or calls `callback` with it when one is given.
 *
 * @param input The raw message as a Buffer or a string, or a readable stream of it
 * @param options Parser options, see {@link SimpleParserOptions}
 * @throws {TypeError} When `input` is `null` or `undefined`
 */
function simpleParser(input: Source, callback: SimpleParserCallback): void;
function simpleParser(input: Source, options: SimpleParserOptions | null | undefined, callback: SimpleParserCallback): void;
function simpleParser(input: Source, options?: SimpleParserOptions | null): Promise<ParsedMail>;
function simpleParser(
    input: Source,
    options?: SimpleParserOptions | SimpleParserCallback | false | null,
    callback?: SimpleParserCallback
): Promise<ParsedMail> | undefined {
    if (input === null || input === undefined) {
        throw new TypeError('Input cannot be null or undefined.');
    }

    if (!callback && typeof options === 'function') {
        callback = options;
        options = false;
    }

    let promise: Promise<ParsedMail> | undefined;
    let done: (...args: [err: Error | null, mail?: ParsedMail]) => void;
    if (!callback) {
        promise = new Promise((resolve, reject) => {
            done = (err, mail) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(mail!);
                }
            };
        });
    } else {
        done = callback as typeof done;
    }

    // MailParser may emit a non-fatal 'error' and still reach 'end', so settle only once:
    // the first error or the result wins
    let settled = false;
    let settle = (...args: [err: Error | null, mail?: ParsedMail]) => {
        if (settled) {
            return;
        }
        settled = true;
        done(...args);
    };

    let parserOptions: SimpleParserOptions = (options as SimpleParserOptions | false | null | undefined) || {};
    let keepCidLinks = !!parserOptions.keepCidLinks;

    let mail: any = {
        attachments: []
    };

    let parser = new MailParser(parserOptions);

    parser.on('error', err => {
        settle(err);
    });

    parser.on('headers', headers => {
        mail.headers = headers;
        mail.headerLines = parser.headerLines;
    });

    let reading = false;
    let reader = () => {
        reading = true;

        let data: any = parser.read();

        if (data === null) {
            reading = false;
            return;
        }

        if (data.type === 'text') {
            Object.keys(data).forEach(key => {
                if (['text', 'html', 'textAsHtml', 'textConversionError'].includes(key)) {
                    mail[key] = data[key];
                }
            });
        }

        if (data.type === 'attachment') {
            let attachment: AttachmentStream = data;
            mail.attachments.push(attachment);

            let chunks: Buffer[] = [];
            let chunklen = 0;
            attachment.content.on('readable', () => {
                let chunk;
                while ((chunk = attachment.content.read()) !== null) {
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
            });

            attachment.content.on('end', () => {
                (attachment as unknown as Attachment).content = Buffer.concat(chunks, chunklen);
                attachment.release!();
                reader();
            });
        } else {
            reader();
        }
    };

    parser.on('readable', () => {
        if (!reading) {
            reader();
        }
    });

    parser.on('end', () => {
        ['subject', 'references', 'date', 'to', 'from', 'to', 'cc', 'bcc', 'message-id', 'in-reply-to', 'reply-to'].forEach(key => {
            if (mail.headers && mail.headers.has(key)) {
                mail[key.replace(/-([a-z])/g, (m, c: string) => c.toUpperCase())] = mail.headers.get(key);
            }
        });

        if (keepCidLinks) {
            return settle(null, mail);
        }
        parser.updateImageLinks(
            (attachment, done) => done(false, 'data:' + attachment.contentType + ';base64,' + (attachment as unknown as Attachment).content.toString('base64')),
            (err, html) => {
                if (err) {
                    return settle(err);
                }
                mail.html = html;

                settle(null, mail);
            }
        );
    });

    if (typeof input === 'string') {
        parser.end(Buffer.from(input));
    } else if (Buffer.isBuffer(input)) {
        parser.end(input);
    } else {
        input
            .once('error', err => {
                input.destroy();
                parser.destroy();
                settle(err);
            })
            .pipe(parser);
    }

    return promise;
}

export default simpleParser;
