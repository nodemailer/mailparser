import mailsplit from '@zone-eu/mailsplit';
import FlowedDecoder from '@zone-eu/mailsplit/lib/flowed-decoder.js';
import he from 'he';
import { htmlToText } from 'html-to-text';
import libmime from 'libmime';
import linkifyIt from 'linkify-it';
import addressparser from 'nodemailer/lib/addressparser';
import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import tlds from './tlds.cjs';
import StreamHash from './stream-hash.js';
import { decodeAddresses, formatAddressesHTML, formatAddressesText } from './address-header.js';
import type {
    AddressObject,
    AttachmentStream,
    EmailAddress,
    HeaderLines,
    Headers,
    HeaderValue,
    IconvConstructor,
    ListHeaderEntry,
    MailParserOptions,
    MessageText
} from './types.js';

const { Splitter, ChunkedPassthrough } = mailsplit;

// Bounds for link detection in text bodies. Message content is untrusted and
// linkify-it backtracks heavily on crafted input: matching a host is quadratic
// in the length of a single whitespace-free run and exponential in the number
// of dot separated labels it has to try (a label starting with "xn--" matches
// two of the alternatives in linkify-it's domain pattern, so N such labels can
// be grouped in 2^N ways). Text is therefore scanned one whitespace-delimited
// segment at a time, segments long enough or with enough chained host labels to
// get expensive are left as plain text, and a message may only spend so much
// work in total. Scanning one segment costs roughly length * (length + 1024), so
// the budget is counted in those units rather than in characters - neither a
// few very long segments nor very many short ones can then add up to an
// unbounded scan. Together these keep the worst case at about half a second.
// Ordinary mail stays far below all three: across test/fixtures the longest
// segment is 565 characters and 99.9% of them chain up at most 3 host labels.
const MAX_LINKIFY_SEGMENT_LENGTH = 4096;
const MAX_LINKIFY_HOST_LABELS = 6;
const MAX_LINKIFY_WORK = 768 * 1024 * 1024; // shared by all text parts of a message

// Default upper bound for the total length of the URLs updateImageLinks() writes
// into the HTML (options.maxInlinedImagesSize). simpleParser inlines every cid:
// reference as a full data: URL, so a small message repeating a reference to
// one image thousands of times would otherwise grow the HTML past the maximum
// string length. References beyond the budget are left as cid: links.
const MAX_INLINED_IMAGES_SIZE = 20 * 1024 * 1024;

// List-* header names that must not become keys of the plain list object
const UNSAFE_LIST_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const linkify = linkifyIt();

linkify
    .tlds(tlds) // Reload with full tlds list
    .tlds('onion', true) // Add unofficial `.onion` domain
    .add('git:', 'http:') // Add `git:` ptotocol as "alias"
    .add('ftp:', null) // Disable `ftp:` ptotocol
    .set({ fuzzyIP: true, fuzzyLink: true, fuzzyEmail: true });

// Characters linkify-it accepts inside a host name: letters, digits, a dash,
// and anything non-ASCII (its label pattern takes any character that is not
// punctuation, whitespace or a control character).
function isHostChar(code: number): boolean {
    return (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a) || (code >= 0x30 && code <= 0x39) || code === 0x2d || code >= 0x80;
}

// twitter linkifier from
// https://github.com/markdown-it/linkify-it#example-2-add-twitter-mentions-handler
linkify.add('@', {
    validate(text, pos, self) {
        let tail = text.slice(pos);

        if (!self.re.twitter) {
            self.re.twitter = new RegExp('^([a-zA-Z0-9_]){1,15}(?!_)(?=$|' + self.re.src_ZPCc + ')');
        }
        if (self.re.twitter.test(tail)) {
            // Linkifier allows punctuation chars before prefix,
            // but we additionally disable `@` ("@@mention" is invalid)
            if (pos >= 2 && text[pos - 2] === '@') {
                return false;
            }
            return tail.match(self.re.twitter)![0].length;
        }
        return 0;
    },
    normalize(match: linkifyIt.Match) {
        match.url = 'https://twitter.com/' + match.url.replace(/^@/, '');
    }
});

// Lists the parameters a header value gives in RFC 2231 form (name*=, name*0= or
// name*0*=). libmime decodes those while parsing the header, so the result must not go
// through decodeWords as well: filename*=utf-8''a%3D%3Futf-8%3FQ%3F%3D2Eexe%3F%3D would
// otherwise come out as "a.exe" while a parser that decodes once sees the encoded word.
function rfc2231ParamNames(value: string): Set<string> {
    let names = new Set<string>();
    let quote = false;
    let escaped = false;
    let start = 0;

    let addSegment = (end: number) => {
        let segment = value.substring(start, end);
        let eq = segment.indexOf('=');
        if (eq < 0) {
            return;
        }
        let match = segment
            .substring(0, eq)
            .trim()
            .toLowerCase()
            .match(/^(.+?)\*(\d+\*?)?$/);
        if (match) {
            names.add(match[1]);
        }
    };

    for (let i = 0; i < value.length; i++) {
        let chr = value.charAt(i);
        if (escaped) {
            escaped = false;
        } else if (chr === '\\') {
            escaped = true;
        } else if (chr === '"') {
            quote = !quote;
        } else if (chr === ';' && !quote) {
            addSegment(i);
            start = i + 1;
        }
    }
    addSegment(value.length);

    return names;
}

// Deepest element nesting html-to-text is asked to convert. htmlparser2 keeps its open
// element stack at the front of an array, so parsing alone is quadratic in the nesting
// depth (200k nested <b> took 9 s), and html-to-text's recursive walk overflows the call
// stack at about 2000 levels. Real markup stays far below this: Chrome's own parser
// flattens anything nested deeper than 512 levels.
const MAX_HTML_NESTING_DEPTH = 1000;

// Elements that never hold content, so a start tag does not open a level
const HTML_VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Elements the HTML parser closes implicitly when a sibling opens (li after li, td after
// td, p after p), so an unclosed run of them does not nest. They are left out of the depth
// count: a report with thousands of unclosed table cells is sloppy but common markup
const HTML_IMPLIED_END_ELEMENTS = new Set(['p', 'li', 'dt', 'dd', 'option', 'optgroup', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'rt', 'rp']);

function isTagNameChar(code: number): boolean {
    return (
        (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a) || (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x3a || code === 0x5f
    );
}

// Reports whether `html` nests elements deeper than `maxDepth`, in one linear pass that
// follows what htmlparser2 builds: a start tag opens an element (a trailing "/" does not
// close it in HTML mode), an end tag closes down to the nearest open element of that name
// and is ignored otherwise, comments are skipped. Returns as soon as the limit is crossed.
function exceedsHtmlNestingDepth(html: string, maxDepth: number): boolean {
    let stack: string[] = [];
    let open = new Map<string, number>(); // element name -> how many of them are on the stack
    let len = html.length;
    let i = html.indexOf('<');
    while (i >= 0) {
        let pos = i + 1;
        if (html.startsWith('!--', pos)) {
            let end = html.indexOf('-->', pos + 3);
            i = end < 0 ? -1 : html.indexOf('<', end + 3);
            continue;
        }
        let closing = html.charCodeAt(pos) === 0x2f; // "/"
        if (closing) {
            pos++;
        }
        let nameStart = pos;
        while (pos < len && isTagNameChar(html.charCodeAt(pos))) {
            pos++;
        }
        if (pos === nameStart) {
            // not a tag, "<" is text here
            i = html.indexOf('<', pos);
            continue;
        }
        let name = html.slice(nameStart, pos).toLowerCase();
        let end = html.indexOf('>', pos);
        if (end < 0) {
            break;
        }
        if (!HTML_VOID_ELEMENTS.has(name) && !HTML_IMPLIED_END_ELEMENTS.has(name)) {
            if (!closing) {
                stack.push(name);
                open.set(name, (open.get(name) || 0) + 1);
                if (stack.length > maxDepth) {
                    return true;
                }
            } else if (open.get(name)) {
                let popped: string;
                do {
                    popped = stack.pop()!;
                    open.set(popped, open.get(popped)! - 1);
                } while (popped !== name);
            }
        }
        i = html.indexOf('<', end + 1);
    }
    return false;
}

// Charsets a body is never decoded from, matched the way iconv-lite and node-iconv compare names
// (case and punctuation ignored). UTF-7 can carry markup past a filter that looks for "<" (a body
// of +ADw-script+AD4- decodes to <script>), base64 and hex are transfer encodings. libmime's decode
// stream refuses the same names, this check applies the refusal to the native Iconv option as well
const REFUSED_CHARSET = /^(?:(?:cs)?unicode11)?utf7(?:imap)?$|^base64$|^hex$/;

function isRefusedCharset(charset: string): boolean {
    return REFUSED_CHARSET.test((charset || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
}

class IconvDecoder extends Transform {
    stream: NodeJS.ReadWriteStream;
    inputEnded: boolean;
    endCb: TransformCallback | false;

    constructor(Iconv: IconvConstructor, charset: string) {
        super();

        // Iconv throws error on ks_c_5601-1987 when it is mapped to EUC-KR
        // https://github.com/bnoordhuis/node-iconv/issues/169
        if (charset.toLowerCase() === 'ks_c_5601-1987') {
            charset = 'CP949';
        }
        this.stream = new Iconv(charset, 'UTF-8//TRANSLIT//IGNORE');

        this.inputEnded = false;
        this.endCb = false;

        this.stream.on('error', err => this.emit('error', err));
        this.stream.on('data', chunk => this.push(chunk));
        this.stream.on('end', () => {
            this.inputEnded = true;
            if (typeof this.endCb === 'function') {
                this.endCb();
            }
        });
    }

    override _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
        this.stream.write(chunk);
        done();
    }

    override _flush(done: TransformCallback): void {
        this.endCb = done;
        this.stream.end();
    }
}

interface Decoder {
    decodeStream(charset: string): NodeJS.ReadWriteStream;
}

/**
 * One MIME part of the message tree the parser builds.
 * @internal
 */
export interface ParserNode {
    node: any;
    headerLines: HeaderLines;
    headers: Headers;
    contentType: string;
    children: ParserNode[];
    root?: boolean;
    parent?: ParserNode;
    disposition?: string;
    isAttachment?: boolean;
    encoding?: string;
    charset?: string;
    decoder?: Transform;
    contentStream?: Transform | NodeJS.ReadWriteStream;
    textContent?: string;
    showMeta?: boolean;
}

/**
 * A lower level, streaming e-mail parser. It is a Transform stream: write the raw message in and
 * read the parsed content out. It emits:
 *
 * - a `headers` event with the parsed headers of the message (see {@link Headers}),
 * - a `headerLines` event with the raw header lines,
 * - an {@link AttachmentStream} object for every attachment, whose content stream has to be read
 *   and `release()` called before the parser continues,
 * - one {@link MessageText} object with the text content at the end.
 *
 * For one-shot parsing into a single object, use `simpleParser` instead.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- the interface below only narrows inherited stream methods
class MailParser extends Transform {
    /** The options the parser was created with. */
    options: MailParserOptions;
    /** The parsed headers of the message, `false` until they have been parsed. */
    headers: Headers | false;
    /** The raw header lines of the message, `false` until they have been parsed. */
    headerLines: HeaderLines | false;
    /** The plain text content, `false` until the message has been parsed or when there is none. */
    text: string | false;
    /** The HTML content, `false` until the message has been parsed or when there is none. */
    html: string | false;
    /** The plain text content as HTML, `false` until the message has been parsed or when there is none. */
    textAsHtml: string | false;

    /** The `Subject` header, set once the headers have been parsed. */
    subject?: string;
    /** The `References` header, set once the headers have been parsed. */
    references?: string | string[];
    /** The `Date` header, set once the headers have been parsed. */
    date?: Date;
    /** The `To` header, set once the headers have been parsed. */
    to?: AddressObject | AddressObject[];
    /** The `From` header, set once the headers have been parsed. */
    from?: AddressObject;
    /** The `Cc` header, set once the headers have been parsed. */
    cc?: AddressObject | AddressObject[];
    /** The `Bcc` header, set once the headers have been parsed. */
    bcc?: AddressObject | AddressObject[];
    /** The `Message-ID` header, set once the headers have been parsed. */
    messageId?: string;
    /** The `In-Reply-To` header, set once the headers have been parsed. */
    inReplyTo?: string;
    /** The `Reply-To` header, set once the headers have been parsed. */
    replyTo?: AddressObject;

    /** @internal */
    chunkedPassthrough: Transform;
    /** @internal */
    splitter: Transform;
    /** @internal */
    finished: boolean;
    /** @internal */
    waitingEnd: ((err?: Error) => void) | false;
    /** @internal */
    endReceived: boolean;
    /** @internal */
    reading: boolean;
    /** @internal */
    hasFailed: boolean;
    /** @internal */
    tree: ParserNode | false;
    /** @internal */
    curnode: ParserNode | false;
    /** @internal */
    waitUntilAttachmentEnd: boolean;
    /** @internal */
    attachmentCallback: (() => void) | false;
    /** @internal */
    hasHtml: boolean;
    /** @internal */
    hasText: boolean;
    /** @internal */
    linkifyWork: number;
    /** @internal */
    attachmentList: AttachmentStream[];
    /** @internal */
    textTypes: string[];
    /** @internal */
    decoder: Decoder;
    /** @internal */
    decoderEnded?: boolean;
    /** @internal */
    libmime: libmime.Libmime;

    constructor(config?: MailParserOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: false
        });

        this.options = config || {};
        // mailsplit declares its streams with only a 'data' event, the parser uses the other Transform events too
        this.chunkedPassthrough = new ChunkedPassthrough() as unknown as Transform;
        this.splitter = new Splitter(config) as unknown as Transform;

        this.chunkedPassthrough.pipe(this.splitter);

        this.finished = false;
        this.waitingEnd = false;

        this.headers = false;
        this.headerLines = false;

        this.endReceived = false;
        this.reading = false;
        this.hasFailed = false;

        this.tree = false;
        this.curnode = false;
        this.waitUntilAttachmentEnd = false;
        this.attachmentCallback = false;

        this.hasHtml = false;
        this.hasText = false;

        this.text = false;
        this.html = false;
        this.textAsHtml = false;
        this.linkifyWork = 0;

        this.attachmentList = [];

        this.textTypes = ['text/plain', 'text/html'].concat(!this.options.keepDeliveryStatus ? 'message/delivery-status' : []);

        this.decoder = this.getDecoder();

        this.chunkedPassthrough.on('error', err => {
            this.splitter.emit('error', err);
        });

        this.splitter.on('readable', () => {
            if (this.reading) {
                return false;
            }
            this.readData();
        });

        this.splitter.on('end', () => {
            this.endReceived = true;
            if (!this.reading) {
                this.endStream();
            }
        });

        this.splitter.on('error', err => {
            this.hasFailed = true;
            if (typeof this.waitingEnd === 'function') {
                return this.waitingEnd(err);
            }
            this.emit('error', err);
        });

        this.libmime = new libmime.Libmime({ Iconv: this.options.Iconv });
    }

    /** @internal */
    getDecoder(): Decoder {
        if (this.options.Iconv) {
            const Iconv = this.options.Iconv;
            // create wrapper
            return {
                decodeStream(charset) {
                    if (isRefusedCharset(charset)) {
                        // the same refusal as without the Iconv option, see below
                        return libmime.createDecodeStream(charset);
                    }
                    // node-iconv resolves its own charset aliases and needs charset-specific
                    // fixups (see IconvDecoder, eg. ks_c_5601-1987), so pass the charset through as is
                    return new IconvDecoder(Iconv, charset);
                }
            };
        } else {
            return {
                decodeStream(charset) {
                    // libmime resolves charset aliases (eg. iso-8859-8-i -> ISO-8859-8), decodes the
                    // Japanese charsets iconv-lite lacks and keeps a multibyte character split across
                    // chunks intact. A charset it does not know or refuses (UTF-7, which would turn
                    // +ADw-script+AD4- into <script>, and the base64 and hex transfer encodings) is
                    // decoded as UTF-8 with invalid bytes replaced, the same as encoded words get
                    return libmime.createDecodeStream(charset || 'ascii');
                }
            };
        }
    }

    /** @internal */
    readData(): false | void {
        if (this.hasFailed) {
            return false;
        }
        this.reading = true;
        let data = this.splitter.read();
        if (data === null) {
            this.reading = false;
            if (this.endReceived) {
                this.endStream();
            }
            return;
        }

        this.processChunk(data, err => {
            if (err) {
                if (typeof this.waitingEnd === 'function') {
                    return this.waitingEnd(err);
                }
                return this.emit('error', err);
            }
            setImmediate(() => this.readData());
        });
    }

    /** @internal */
    endStream(): void {
        this.finished = true;

        if (this.curnode && this.curnode.decoder) {
            this.curnode.decoder.end();
        }
        if (typeof this.waitingEnd === 'function') {
            this.waitingEnd();
        }
    }

    override _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
        if (!chunk || !chunk.length) {
            return done();
        }

        if (this.chunkedPassthrough.write(chunk) === false) {
            this.chunkedPassthrough.once('drain', () => {
                done();
            });
            return;
        } else {
            return done();
        }
    }

    override _flush(done: TransformCallback): void {
        setImmediate(() => this.chunkedPassthrough.end());
        if (this.finished) {
            return this.cleanup(done);
        }
        this.waitingEnd = err => {
            // runs once, either on a splitter error after end of input or when the splitter ends
            this.waitingEnd = false;
            if (err) {
                return done(err);
            }
            this.cleanup(done);
        };
    }

    /** @internal */
    cleanup(done: TransformCallback): void {
        let finish = () => {
            try {
                let t = this.getTextContent();
                this.push(t);
            } catch (err) {
                // report through the stream instead of leaving _flush hanging
                return done(err as Error);
            }

            done();
        };

        if (this.curnode && this.curnode.decoder && this.curnode.decoder.readable && !this.decoderEnded) {
            (this.curnode.contentStream || this.curnode.decoder).once('end', () => {
                finish();
            });
            this.curnode.decoder.end();
        } else {
            setImmediate(() => {
                finish();
            });
        }
    }

    /** @internal */
    processHeaders(lines: Array<{ key: string; line: string }> | undefined): Headers {
        let headers = new Map<string, any>();
        (lines || []).forEach(line => {
            let key = line.key;
            let value: any = ((this.libmime.decodeHeader(line.line) || {}).value || '').toString().trim();
            value = Buffer.from(value, 'binary').toString();
            switch (key) {
                case 'content-type':
                case 'content-disposition':
                case 'dkim-signature': {
                    // a parameter given in RFC 2231 form is decoded by parseHeaderValue already
                    let rfc2231 = rfc2231ParamNames(value);
                    value = this.libmime.parseHeaderValue(value);
                    if (value.value) {
                        value.value = this.libmime.decodeWords(value.value);
                    }
                    Object.keys((value && value.params) || {}).forEach(key => {
                        if (rfc2231.has(key)) {
                            return;
                        }
                        try {
                            value.params[key] = this.libmime.decodeWords(value.params[key]);
                        } catch {
                            // ignore, keep as is
                        }
                    });
                    break;
                }
                case 'date': {
                    let dateValue = new Date(value);
                    if (isNaN(dateValue.getTime())) {
                        // date parsing failed :S
                        dateValue = new Date();
                    }
                    value = dateValue;
                    break;
                }
                case 'subject':
                    try {
                        value = this.libmime.decodeWords(value);
                    } catch {
                        // ignore, keep as is
                    }
                    break;
                case 'references':
                    try {
                        value = this.libmime.decodeWords(value);
                    } catch {
                        // ignore
                    }
                    value = value
                        .split(/\s+/)
                        .map(this.ensureMessageIDFormat)
                        .filter((val: string | false) => val);
                    break;
                case 'message-id':
                case 'in-reply-to':
                    try {
                        value = this.libmime.decodeWords(value);
                    } catch {
                        // ignore
                    }
                    value = this.ensureMessageIDFormat(value);
                    break;
                case 'priority':
                case 'x-priority':
                case 'x-msmail-priority':
                case 'importance':
                    key = 'priority';
                    value = this.parsePriority(value);
                    break;
                case 'from':
                case 'to':
                case 'cc':
                case 'bcc':
                case 'sender':
                case 'reply-to':
                case 'delivered-to':
                case 'return-path':
                case 'disposition-notification-to':
                    value = addressparser(value);
                    this.decodeAddresses(value);
                    value = {
                        value,
                        html: this.getAddressesHTML(value),
                        text: this.getAddressesText(value)
                    };
                    break;
            }

            // handle list-* keys
            if (key.slice(0, 5) === 'list-') {
                value = this.parseListHeader(key.slice(5), value);
                key = 'list';
            }

            if (value) {
                if (!headers.has(key)) {
                    headers.set(key, [].concat(value || []));
                } else if (Array.isArray(value)) {
                    // appended in place: rebuilding the list with concat for every repeated
                    // header was quadratic in the number of References lines
                    let list = headers.get(key);
                    for (let entry of value) {
                        list.push(entry);
                    }
                } else {
                    headers.get(key).push(value);
                }
            }
        });

        // keep only the first value
        let singleKeys = [
            'message-id',
            'content-id',
            'from',
            'sender',
            'in-reply-to',
            'reply-to',
            'subject',
            'date',
            'content-disposition',
            'content-type',
            'content-transfer-encoding',
            'priority',
            'mime-version',
            'content-description',
            'precedence',
            'errors-to',
            'disposition-notification-to'
        ];

        headers.forEach((value, key) => {
            if (Array.isArray(value)) {
                if (singleKeys.includes(key) && value.length) {
                    // the first occurrence: the one mailsplit built the MIME structure from,
                    // and the one mail clients display when the header is duplicated
                    headers.set(key, value[0]);
                } else if (value.length === 1) {
                    headers.set(key, value[0]);
                }
            }

            if (key === 'list') {
                // normalize List-* headers
                let listValue: Record<string, ListHeaderEntry> = {};
                [].concat(value || []).forEach((val: Record<string, ListHeaderEntry>) => {
                    Object.keys(val || {}).forEach(listKey => {
                        listValue[listKey] = val[listKey]!;
                    });
                });
                headers.set(key, listValue);
            }
        });

        return headers as Headers;
    }

    /** @internal */
    parseListHeader(key: string, value: string): Record<string, ListHeaderEntry> | false {
        if (UNSAFE_LIST_KEYS.has(key)) {
            // would replace the prototype of (or shadow) the normalized list object
            return false;
        }
        let addresses = addressparser(value);
        let response: ListHeaderEntry = {};
        let data = addresses
            .map(address => {
                if (/^https?:/i.test(address.name)) {
                    response.url = address.name;
                } else if (address.name) {
                    response.name = address.name;
                }
                if (/^mailto:/.test(address.address || '')) {
                    response.mail = address.address!.slice(7);
                } else if (address.address && address.address.indexOf('@') < 0) {
                    response.id = address.address;
                } else if (address.address) {
                    response.mail = address.address;
                }
                if (Object.keys(response).length) {
                    return response;
                }
                return false;
            })
            .filter(address => address);
        if (data.length) {
            return {
                [key]: response
            };
        }
        return false;
    }

    /**
     * Turns a `Priority`, `X-Priority`, `X-MSMail-Priority` or `Importance` header value into
     * `'high'`, `'normal'` or `'low'`.
     */
    parsePriority(value: string): 'high' | 'normal' | 'low' {
        value = value.toLowerCase().trim();
        if (!isNaN(parseInt(value, 10))) {
            // support "X-Priority: 1 (Highest)"
            let level = parseInt(value, 10) || 0;
            if (level === 3) {
                return 'normal';
            } else if (level > 3) {
                return 'low';
            } else {
                return 'high';
            }
        } else {
            switch (value) {
                case 'non-urgent':
                case 'low':
                    return 'low';
                case 'urgent':
                case 'high':
                    return 'high';
            }
        }
        return 'normal';
    }

    /**
     * Wraps a Message-ID in angle brackets where they are missing. Returns `false` for an empty value.
     */
    ensureMessageIDFormat(value: string): string | false {
        if (!value.length) {
            return false;
        }

        if (value.charAt(0) !== '<') {
            value = '<' + value;
        }

        if (value.charAt(value.length - 1) !== '>') {
            value += '>';
        }

        return value;
    }

    /** @internal */
    decodeAddresses(addresses: EmailAddress[]): void {
        decodeAddresses(addresses, this.libmime);
    }

    /** @internal */
    createNode(node: any): ParserNode {
        let contentType = node.contentType;
        let disposition = node.disposition;
        let encoding = node.encoding;
        let charset = node.charset;

        if (!contentType && node.root) {
            contentType = 'text/plain';
        }

        let newNode: ParserNode = {
            node,
            headerLines: node.headers.lines,
            headers: this.processHeaders(node.headers.getList()),
            contentType,
            children: []
        };

        if (!/^multipart\//i.test(contentType)) {
            if (disposition && !['attachment', 'inline'].includes(disposition)) {
                disposition = 'attachment';
            }

            if (!disposition && !this.textTypes.includes(contentType)) {
                newNode.disposition = 'attachment';
            } else {
                newNode.disposition = disposition || 'inline';
            }

            newNode.isAttachment = !this.textTypes.includes(contentType) || newNode.disposition !== 'inline';

            newNode.encoding = ['quoted-printable', 'base64'].includes(encoding) ? encoding : 'binary';

            if (charset) {
                newNode.charset = charset;
            }

            let decoder: Transform = node.getDecoder();
            decoder.on('end', () => {
                this.decoderEnded = true;
            });
            newNode.decoder = decoder;
        }

        if (node.root) {
            this.headers = newNode.headers;
            this.headerLines = newNode.headerLines;
        }

        // find location in tree

        if (!this.tree || !this.curnode) {
            newNode.root = true;
            this.curnode = this.tree = newNode;
            return newNode;
        }

        // immediate child of root node
        if (!this.curnode.parent) {
            newNode.parent = this.curnode;
            this.curnode.children.push(newNode);
            this.curnode = newNode;
            return newNode;
        }

        // siblings
        if (this.curnode.parent.node === node.parentNode) {
            newNode.parent = this.curnode.parent;
            this.curnode.parent.children.push(newNode);
            this.curnode = newNode;
            return newNode;
        }

        // first child
        if (this.curnode.node === node.parentNode) {
            newNode.parent = this.curnode;
            this.curnode.children.push(newNode);
            this.curnode = newNode;
            return newNode;
        }

        // move up
        let parentNode: ParserNode | undefined = this.curnode;
        while ((parentNode = parentNode.parent)) {
            if (parentNode.node === node.parentNode) {
                newNode.parent = parentNode;
                parentNode.children.push(newNode);
                this.curnode = newNode;
                return newNode;
            }
        }

        // should never happen, can't detect parent
        this.curnode = newNode;
        return newNode;
    }

    /** @internal */
    getTextContent(): MessageText {
        let text: string[] = [];
        let html: string[] = [];
        let textConversionError: Error | null = null;
        let processNode = (alternative: boolean, level: number, node: ParserNode) => {
            if (node.showMeta) {
                let meta = ['From', 'Subject', 'Date', 'To', 'Cc', 'Bcc']
                    .map(fkey => {
                        let key = fkey.toLowerCase();
                        if (!node.headers.has(key)) {
                            return false;
                        }
                        let value = node.headers.get(key);
                        if (!value) {
                            return false;
                        }
                        return {
                            key: fkey,
                            value: (Array.isArray(value) ? value[value.length - 1] : value) as any
                        };
                    })
                    .filter(entry => entry) as Array<{ key: string; value: any }>;
                if (this.hasHtml) {
                    html.push(
                        '<table class="mp_head">' +
                            meta
                                .map(entry => {
                                    let value = entry.value;
                                    switch (entry.key) {
                                        case 'From':
                                        case 'To':
                                        case 'Cc':
                                        case 'Bcc':
                                            value = value.html;
                                            break;
                                        case 'Date':
                                            value = this.options.formatDateString ? this.options.formatDateString(value) : value.toUTCString();
                                            break;
                                        case 'Subject':
                                            value = '<strong>' + he.encode(value) + '</strong>';
                                            break;
                                        default:
                                            value = he.encode(value);
                                    }

                                    return '<tr><td class="mp_head_key">' + he.encode(entry.key) + ':</td><td class="mp_head_value">' + value + '<td></tr>';
                                })
                                .join('\n') +
                            '<table>'
                    );
                }
                if (this.hasText) {
                    text.push(
                        '\n' +
                            meta
                                .map(entry => {
                                    let value = entry.value;
                                    switch (entry.key) {
                                        case 'From':
                                        case 'To':
                                        case 'Cc':
                                        case 'Bcc':
                                            value = value.text;
                                            break;
                                        case 'Date':
                                            value = this.options.formatDateString ? this.options.formatDateString(value) : value.toUTCString();
                                            break;
                                    }
                                    return entry.key + ': ' + value;
                                })
                                .join('\n') +
                            '\n'
                    );
                }
            }
            if (node.textContent) {
                if (node.contentType === 'text/plain') {
                    text.push(node.textContent);
                    if (!alternative && this.hasHtml) {
                        html.push(this.textToHtml(node.textContent));
                    }
                } else if (node.contentType === 'message/delivery-status' && !this.options.keepDeliveryStatus) {
                    text.push(node.textContent);
                    if (!alternative && this.hasHtml) {
                        html.push(this.textToHtml(node.textContent));
                    }
                } else if (node.contentType === 'text/html') {
                    if ((!alternative && this.hasText) || (node.root && !this.hasText)) {
                        if (this.options.skipHtmlToText) {
                            text.push('');
                        } else {
                            // HTML that can not be converted is no reason to lose the message:
                            // the text stays empty, the HTML is kept and the reason travels with
                            // the result as textConversionError. An 'error' event here used to
                            // reject the whole simpleParser() promise, headers and attachments
                            // included, after burning the CPU the conversion attempt took
                            let err: Error | null = null;
                            if (node.textContent.length > (this.options.maxHtmlLengthToParse as number)) {
                                err = new Error(`HTML too long for parsing ${node.textContent.length} bytes`);
                            } else if (exceedsHtmlNestingDepth(node.textContent, MAX_HTML_NESTING_DEPTH)) {
                                err = new Error(`HTML nested deeper than ${MAX_HTML_NESTING_DEPTH} levels`);
                            } else {
                                try {
                                    text.push(htmlToText(node.textContent, { limits: { maxDepth: MAX_HTML_NESTING_DEPTH } }));
                                } catch (cause) {
                                    err = new Error('Failed to parse HTML', { cause });
                                }
                            }
                            if (err) {
                                text.push('');
                                textConversionError = textConversionError || err;
                            }
                        }
                    }
                    html.push(node.textContent);
                }
            }
            alternative = alternative || node.contentType === 'multipart/alternative';
            if (node.children) {
                node.children.forEach(subNode => {
                    processNode(alternative, level + 1, subNode);
                });
            }
        };

        processNode(false, 0, this.tree as ParserNode);

        let response: MessageText = {
            type: 'text'
        };
        if (html.length) {
            this.html = response.html = html.join('<br/>\n');
        }
        if (text.length) {
            this.text = response.text = text.join('\n');
            this.textAsHtml = response.textAsHtml = text.map(part => this.textToHtml(part)).join('<br/>\n');
        }
        if (textConversionError) {
            response.textConversionError = textConversionError;
        }
        return response;
    }

    /** @internal */
    processChunk(data: any, done: (err?: Error) => void): void {
        let partId: string | null = null;
        if (data._parentBoundary) {
            // mailsplit numbers parts IMAP style from the actual tree, TEXT markers are not part of the id
            partId = ((data.partNr || []) as Array<number | string>).filter(nr => typeof nr === 'number').join('.') || null;
        }
        switch (data.type) {
            case 'node': {
                let node = this.createNode(data);
                if (node === this.tree) {
                    ['subject', 'references', 'date', 'to', 'from', 'to', 'cc', 'bcc', 'message-id', 'in-reply-to', 'reply-to'].forEach(key => {
                        if (node.headers.has(key)) {
                            (this as any)[key.replace(/-([a-z])/g, (m, c: string) => c.toUpperCase())] = node.headers.get(key);
                        }
                    });
                    this.emit('headers', node.headers);

                    if (node.headerLines) {
                        this.emit('headerLines', node.headerLines);
                    }
                }

                if (data.contentType === 'message/rfc822' && data.messageNode) {
                    break;
                }

                if (data.parentNode && data.parentNode.contentType === 'message/rfc822') {
                    node.showMeta = true;
                }

                if (node.isAttachment) {
                    let decoder = node.decoder!;
                    let contentType = node.contentType;
                    if (node.contentType === 'application/octet-stream' && data.filename) {
                        contentType = this.libmime.detectMimeType(data.filename) || 'application/octet-stream';
                    }

                    // backpressure state for the attachment stream, see pump() below
                    let released = false;
                    let waitingDrain = false;
                    let pump: () => void;

                    let attachment = {
                        type: 'attachment',
                        content: null,
                        contentType,
                        partId,
                        release: () => {
                            attachment.release = null;
                            released = true;
                            if (waitingDrain) {
                                waitingDrain = false;
                                pump();
                            }
                            if (this.waitUntilAttachmentEnd && typeof this.attachmentCallback === 'function') {
                                setImmediate(this.attachmentCallback);
                            }
                            this.attachmentCallback = false;
                            this.waitUntilAttachmentEnd = false;
                        }
                    } as unknown as AttachmentStream;

                    let algo = this.options.checksumAlgo || 'md5';
                    let hasher: StreamHash;
                    try {
                        hasher = new StreamHash(attachment, algo);
                    } catch (err) {
                        // an algorithm this Node does not offer (a typo, or MD5 on a host whose
                        // OpenSSL runs in FIPS mode) is a parser error, not a process-ending throw
                        (err as Error).message = `Checksum algorithm "${algo}" is not available: ${(err as Error).message}`;
                        return done(err as Error);
                    }
                    decoder.on('error', err => {
                        hasher.emit('error', err);
                    });

                    // Honour the consumer's backpressure while it reads the attachment. Once the
                    // attachment is released it is drained regardless, so that a caller that
                    // releases without reading the content does not stall the parser.
                    pump = () => {
                        let chunk;
                        while ((chunk = decoder.read()) !== null) {
                            if (hasher.write(chunk) === false && !released) {
                                waitingDrain = true;
                                hasher.once('drain', () => {
                                    waitingDrain = false;
                                    pump();
                                });
                                return;
                            }
                        }
                    };

                    decoder.on('readable', () => {
                        if (!waitingDrain) {
                            pump();
                        }
                    });

                    decoder.once('end', () => {
                        hasher.end();
                    });

                    //node.decoder.pipe(hasher);
                    attachment.content = hasher;

                    this.waitUntilAttachmentEnd = true;
                    if (data.disposition) {
                        attachment.contentDisposition = data.disposition;
                    }

                    if (data.filename) {
                        attachment.filename = data.filename;
                    }

                    if (node.headers.has('content-id')) {
                        attachment.contentId = ([] as HeaderValue[]).concat(node.headers.get('content-id') || []).shift() as string;
                        attachment.cid = attachment.contentId.trim().replace(/^<|>$/g, '').trim();
                        // check if the attachment is "related" to text content like an embedded image etc
                        let parentNode: ParserNode | undefined = node;
                        while ((parentNode = parentNode.parent)) {
                            if (parentNode.contentType === 'multipart/related') {
                                attachment.related = true;
                            }
                        }
                    }

                    attachment.headers = node.headers;
                    this.push(attachment);
                    this.attachmentList.push(attachment);
                } else if (node.disposition === 'inline') {
                    let chunks: Buffer[] = [];
                    let chunklen = 0;
                    node.contentStream = node.decoder!;

                    if (node.contentType === 'text/plain') {
                        this.hasText = true;
                    } else if (node.contentType === 'text/html') {
                        this.hasHtml = true;
                    } else if (node.contentType === 'message/delivery-status' && !this.options.keepDeliveryStatus) {
                        this.hasText = true;
                    }

                    if (node.node.flowed) {
                        let contentStream = node.contentStream;
                        let flowDecoder = new FlowedDecoder({
                            delSp: node.node.delSp
                        }) as unknown as Transform;
                        contentStream.on('error', err => {
                            flowDecoder.emit('error', err);
                        });
                        contentStream.pipe(flowDecoder);
                        node.contentStream = flowDecoder;
                    }

                    let charset = node.charset || 'utf-8';
                    //charset = charset || 'windows-1257';

                    if (!['ascii', 'usascii', 'utf8'].includes(charset.toLowerCase().replace(/[^a-z0-9]+/g, ''))) {
                        try {
                            let contentStream = node.contentStream;
                            let decodeStream = this.decoder.decodeStream(charset);
                            contentStream.on('error', err => {
                                decodeStream.emit('error', err);
                            });
                            contentStream.pipe(decodeStream);
                            node.contentStream = decodeStream;
                        } catch {
                            // do not decode charset
                        }
                    }

                    let contentStream = node.contentStream;
                    contentStream.on('readable', () => {
                        let chunk;
                        while ((chunk = contentStream.read()) !== null) {
                            if (typeof chunk === 'string') {
                                chunk = Buffer.from(chunk);
                            }
                            chunks.push(chunk);
                            chunklen += chunk.length;
                        }
                    });

                    contentStream.once('end', () => {
                        node.textContent = Buffer.concat(chunks, chunklen).toString().replace(/\r?\n/g, '\n');
                    });

                    contentStream.once('error', err => {
                        this.emit('error', err);
                    });
                }

                break;
            }

            case 'data':
                if (this.curnode && this.curnode.decoder) {
                    this.curnode.decoder.end();
                }

                if (this.waitUntilAttachmentEnd) {
                    this.attachmentCallback = done;
                    return;
                }

                // multipart message structure
                // this is not related to any specific 'node' block as it includes
                // everything between the end of some node body and between the next header
                //process.stdout.write(data.value);
                break;

            case 'body':
                if (this.curnode && this.curnode.decoder && this.curnode.decoder.writable) {
                    if (this.curnode.decoder.write(data.value) === false) {
                        this.curnode.decoder.once('drain', done);
                        return;
                    }
                }

                // Leaf element body. Includes the body for the last 'node' block. You might
                // have several 'body' calls for a single 'node' block
                //process.stdout.write(data.value);
                break;
        }

        setImmediate(done);
    }

    /**
     * Formats parsed addresses for an HTML context, every value HTML-escaped.
     */
    getAddressesHTML(value: EmailAddress | EmailAddress[]): string {
        return formatAddressesHTML(value);
    }

    /**
     * Formats parsed addresses as plain text, display names quoted.
     */
    getAddressesText(value: EmailAddress | EmailAddress[]): string {
        return formatAddressesText(value);
    }

    /**
     * Replaces `cid:` links to image attachments in the HTML content. Call it once the parser has
     * ended. `replaceCallback` is called once for every referenced image attachment and answers with
     * the URL to use instead; `done` gets the updated HTML, or `false` when the message has no HTML.
     * The total length of the URLs written is bounded by `maxInlinedImagesSize`.
     */
    updateImageLinks(
        replaceCallback: (attachment: AttachmentStream, callback: (err: Error | null | false | undefined, url?: string) => void) => void,
        done: (err: Error | null, html?: string | false) => void
    ): void {
        if (!this.html) {
            setImmediate(() => done(null, false));
            return;
        }

        let cids = new Map<string, { attachment: AttachmentStream; url?: string }>();
        let html = (this.html || '').toString();

        if (this.options.skipImageLinks) {
            return done(null, html);
        }

        html.replace(/\bcid:([^'"\s]{1,256})/g, (match, cid: string) => {
            for (let i = 0, len = this.attachmentList.length; i < len; i++) {
                if (this.attachmentList[i].cid === cid && /^image\/[\w]+$/i.test(this.attachmentList[i].contentType)) {
                    cids.set(cid, {
                        attachment: this.attachmentList[i]
                    });
                    break;
                }
            }
            return match;
        });

        let cidList: Array<{ attachment: AttachmentStream; url?: string }> = [];
        cids.forEach(entry => {
            cidList.push(entry);
        });

        let pos = 0;
        let processNext = () => {
            if (pos >= cidList.length) {
                let maxSize = this.options.maxInlinedImagesSize;
                if (typeof maxSize !== 'number' || !(maxSize >= 0)) {
                    maxSize = MAX_INLINED_IMAGES_SIZE;
                }
                let inlinedSize = 0;
                try {
                    html = html.replace(/\bcid:([^'"\s]{1,256})/g, (match, cid: string) => {
                        let url = cids.has(cid) && cids.get(cid)!.url;
                        if (!url) {
                            return match;
                        }
                        url = String(url);
                        if (inlinedSize + url.length > maxSize) {
                            return match;
                        }
                        inlinedSize += url.length;
                        return url;
                    });
                } catch (err) {
                    // runs from setImmediate, a throw here would be an uncaught exception
                    return done(err as Error);
                }

                return done(null, html);
            }
            let entry = cidList[pos++];
            replaceCallback(entry.attachment, (err, url) => {
                if (err) {
                    setImmediate(() => done(err));
                    return;
                }
                entry.url = url as string;
                setImmediate(processNext);
            });
        };

        setImmediate(processNext);
    }

    // Tells whether a text segment is worth handing to linkify-it, see
    // MAX_LINKIFY_* above. Note that linkify.pretest() can not be used for this
    // - it is a quick deny that also denies links its own matcher finds, eg. a
    // host followed by a fullwidth vertical bar.
    /** @internal */
    canScanSegment(segment: string): boolean {
        // every link linkify-it can find contains at least one of these
        if (segment.length > MAX_LINKIFY_SEGMENT_LENGTH || !/[.:@/]/.test(segment)) {
            return false;
        }

        // Dots only chain up into one host candidate while the characters
        // around them could be part of a host, so a slash, comma or colon ends
        // the chain and dots in a path or query do not add to it.
        let labels = 0;
        for (let i = 0, len = segment.length; i < len; i++) {
            let code = segment.charCodeAt(i);
            if (code === 0x2e) {
                if (++labels > MAX_LINKIFY_HOST_LABELS) {
                    return false;
                }
            } else if (!isHostChar(code)) {
                labels = 0;
            }
        }

        return true;
    }

    /** @internal */
    findLinks(str: string): Array<{ index: number; lastIndex: number; text: string; url: string }> {
        let links: Array<{ index: number; lastIndex: number; text: string; url: string }> = [];

        if (this.linkifyWork >= MAX_LINKIFY_WORK || !linkify.pretest(str)) {
            return links;
        }

        // Whitespace can not be part of a link and linkify-it treats the end of
        // a segment exactly like whitespace, so scanning segment by segment
        // finds the same links as scanning the entire string would. U+FEFF is
        // whitespace for Javascript but an ordinary link character for
        // linkify-it, so it must not end a segment.
        let segmentRegex = /[\S\uFEFF]+/g;
        let segmentMatch;

        while ((segmentMatch = segmentRegex.exec(str)) !== null) {
            let segment = segmentMatch[0];

            if (!this.canScanSegment(segment)) {
                // too expensive to scan or can not match at all, keep as plain text
                continue;
            }

            let matches = linkify.match(segment);
            for (let i = 0; matches && i < matches.length; i++) {
                matches[i].index += segmentMatch.index;
                matches[i].lastIndex += segmentMatch.index;
                links.push(matches[i]);
            }

            this.linkifyWork += segment.length * (segment.length + 1024);
            if (this.linkifyWork >= MAX_LINKIFY_WORK) {
                break;
            }
        }

        return links;
    }

    /**
     * Converts plain text to HTML the way `textAsHtml` is built: HTML-escaped, paragraphs and line
     * breaks kept, and links turned into anchors unless `skipTextLinks` is set. Returns an empty
     * string when `skipTextToHtml` is set.
     */
    textToHtml(str: string): string {
        if (this.options.skipTextToHtml) {
            return '';
        }
        str = (str || '').toString();
        let encoded;

        if (!this.options.skipTextLinks) {
            try {
                let links = this.findLinks(str);
                if (links.length) {
                    let result: string[] = [];
                    let last = 0;

                    links.forEach(link => {
                        if (last < link.index) {
                            let textPart = he
                                // encode special chars
                                .encode(str.slice(last, link.index), {
                                    useNamedReferences: true
                                });
                            result.push(textPart);
                        }

                        // Escape quotes in URL to prevent XSS
                        let safeUrl = link.url.replace(/"/g, '&quot;');
                        // Escape HTML entities in link text
                        let safeText = he.encode(link.text, { useNamedReferences: true });
                        result.push(`<a href="${safeUrl}">${safeText}</a>`);

                        last = link.lastIndex;
                    });

                    let textPart = he
                        // encode special chars
                        .encode(str.slice(last), {
                            useNamedReferences: true
                        });
                    result.push(textPart);

                    encoded = result.join('');
                }
            } catch {
                // failed, don't linkify
            }
        }

        // nothing linkified, or linkifying threw halfway through
        if (!encoded) {
            encoded = he
                // encode special chars
                .encode(str, {
                    useNamedReferences: true
                });
        }

        let text =
            '<p>' +
            encoded
                .replace(/\r?\n/g, '\n')
                .trim() // normalize line endings
                // Trims trailing spaces and tabs off every line. The leading
                // group keeps this linear, plain /[ \t]+$/gm rescans the whole
                // run from every position inside it, which is quadratic. The
                // lookahead lists the line terminators that multiline $ matches
                // before, the group covers the line starts.
                .replace(/(^|[^ \t])[ \t]+(?=[\n\r\u2028\u2029]|$)/g, '$1')
                .trim() // trim empty line endings
                .replace(/\n\n+/g, '</p><p>')
                .trim() // insert <p> to multiple linebreaks
                .replace(/\n/g, '<br/>') + // insert <br> to single linebreaks
            '</p>';

        return text;
    }
}

// Event and read() signatures for the objects the parser emits. Declared on a merged interface
// because they narrow methods MailParser inherits from Transform without overriding them
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see above
interface MailParser {
    /** Emitted once with the parsed headers of the message. */
    on(event: 'headers', listener: (headers: Headers) => void): this;
    /** Emitted once with the raw header lines of the message. */
    on(event: 'headerLines', listener: (headerLines: HeaderLines) => void): this;
    /** Emitted for every attachment and, at the end, once for the text content. */
    on(event: 'data', listener: (data: AttachmentStream | MessageText) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    once(event: 'headers', listener: (headers: Headers) => void): this;
    once(event: 'headerLines', listener: (headerLines: HeaderLines) => void): this;
    once(event: 'data', listener: (data: AttachmentStream | MessageText) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    /** Returns the next attachment or text content object, or `null` when none is buffered. */
    read(size?: number): AttachmentStream | MessageText | null;
}

export default MailParser;
