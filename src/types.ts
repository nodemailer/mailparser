import type { Readable } from 'node:stream';

/**
 * A structured header value with parameters, as produced for `Content-Type`,
 * `Content-Disposition` and `DKIM-Signature`.
 *
 * `Content-Type: text/plain; charset="UTF-8"` becomes
 * `{ value: 'text/plain', params: { charset: 'UTF-8' } }`.
 */
export interface StructuredHeader {
    /** The main value, without parameters. Encoded words are decoded. */
    value: string;
    /** Parameters keyed by lowercase name. RFC 2231 and RFC 2047 encoded values are decoded. */
    params: { [key: string]: string };
}

/**
 * One mailbox or group of an address header.
 */
export interface EmailAddress {
    /** The display name, or the group name for a group. Empty string when the header gave none. */
    name: string;
    /** The address, with an internationalized (punycode) domain decoded to Unicode. Not set for a group. */
    address?: string;
    /** The members of a group, when this entry is a group (`Group: a@example.com, b@example.com;`). */
    group?: EmailAddress[];
}

/**
 * A parsed address header (`From`, `To`, `Cc`, `Bcc`, `Sender`, `Reply-To`, `Delivered-To`,
 * `Return-Path`, `Disposition-Notification-To`).
 */
export interface AddressObject {
    /** The parsed addresses. */
    value: EmailAddress[];
    /** The addresses formatted for an HTML context, with every value HTML-escaped. */
    html: string;
    /** The addresses formatted as plain text, display names quoted. */
    text: string;
}

/**
 * One entry of the combined `list` header, built from a `List-*` header such as `List-Unsubscribe`.
 */
export interface ListHeaderEntry {
    /** An `http:` or `https:` URL from the header. */
    url?: string;
    /** A display name from the header. */
    name?: string;
    /** An e-mail address from the header, without the `mailto:` prefix. */
    mail?: string;
    /** A value without an `@`, such as the `List-Id` identifier. */
    id?: string;
}

/**
 * The combined `List-*` headers, keyed by the part of the header name after `list-`. For example
 * `List-Unsubscribe` is found under `unsubscribe` and `List-Id` under `id`.
 */
export interface ListHeaders {
    [key: string]: ListHeaderEntry;
}

/**
 * A parsed header value. What a header parses into depends on its name:
 *
 * - address headers are {@link AddressObject} values,
 * - `Date` is a `Date` (the current time when the header can not be parsed),
 * - `Content-Type`, `Content-Disposition` and `DKIM-Signature` are {@link StructuredHeader} values,
 * - `References` is a string, or an array of strings when it lists more than one Message-ID,
 * - `Priority`, `X-Priority`, `X-MSMail-Priority` and `Importance` are combined into `priority`,
 *   one of `'high'`, `'normal'` or `'low'`,
 * - `List-*` headers are combined into `list`, see {@link ListHeaders},
 * - every other header is its decoded string value.
 *
 * A header that is repeated becomes an array of values, except for the headers that can only appear
 * once (`From`, `Subject`, `Date`, `Message-ID`, `Content-Type` and the like), which keep their first
 * occurrence.
 */
export type HeaderValue = string | string[] | Date | AddressObject | AddressObject[] | StructuredHeader | StructuredHeader[] | ListHeaders;

/**
 * Parsed headers keyed by lowercase header name.
 */
export type Headers = Map<string, HeaderValue>;

/**
 * The raw header lines in the order they appear, with the lowercase header name as `key` and the
 * unparsed line, folding included, as `line`.
 */
export type HeaderLines = ReadonlyArray<{
    key: string;
    line: string;
}>;

/**
 * The properties every attachment has, whether streamed by {@link MailParser} or buffered by
 * `simpleParser`.
 */
export interface AttachmentCommon {
    /** Identifies an attachment among the objects {@link MailParser} emits. */
    type: 'attachment';
    /** The MIME type. For `application/octet-stream` it is detected from the file name when there is one. */
    contentType: string;
    /** The IMAP style part number (`'1.2'`), or `null` when the message is not multipart. */
    partId: string | null;
    /** The `Content-Disposition` value (`'attachment'`, `'inline'` or whatever the message said), if the part had one. */
    contentDisposition?: string;
    /** The file name, if the part named one. */
    filename?: string;
    /** The parsed MIME headers of the attachment part. */
    headers: Headers;
    /** The `Content-ID` value, angle brackets included, if the part had one. */
    contentId?: string;
    /** The `Content-ID` value without angle brackets, to match against `cid:` URLs. */
    cid?: string;
    /** `true` when the part has a `Content-ID` and sits inside `multipart/related`, such as an embedded image. */
    related?: boolean;
}

/**
 * An attachment as {@link MailParser} emits it: the content is a stream that has to be read, and
 * `release()` called, before the parser continues.
 */
export interface AttachmentStream extends AttachmentCommon {
    /** The decoded attachment content. */
    content: Readable;
    /**
     * Tells the parser the attachment has been handled, so it can continue with the rest of the
     * message. Must be called for every attachment. Set to `null` once called.
     */
    release: (() => void) | null;
    /** The hex encoded checksum of the content (md5 unless `checksumAlgo` says otherwise). Set once `content` has ended. */
    checksum?: string;
    /** The size of the decoded content in bytes. Set once `content` has ended. */
    size?: number;
}

/**
 * An attachment as `simpleParser` returns it, with the content buffered in memory.
 */
export interface Attachment extends AttachmentCommon {
    /** The decoded attachment content. */
    content: Buffer;
    /** Always `null`, `simpleParser` has released the attachment already. */
    release: null;
    /** The hex encoded checksum of the content (md5 unless `checksumAlgo` says otherwise). */
    checksum: string;
    /** The size of the decoded content in bytes. */
    size: number;
}

/**
 * The text content {@link MailParser} emits once, after the whole message has been parsed.
 */
export interface MessageText {
    /** Identifies the text content among the objects {@link MailParser} emits. */
    type: 'text';
    /**
     * The HTML content: every `text/html` part, with plain text parts outside `multipart/alternative`
     * converted to HTML. Not set when the message has no HTML part.
     */
    html?: string;
    /**
     * The plain text content: every `text/plain` part, with HTML converted to text where there is no
     * plain text alternative. Not set when the message has no text at all.
     */
    text?: string;
    /** The plain text content converted to HTML, links included. Set whenever `text` is. */
    textAsHtml?: string;
    /**
     * Why an HTML part could not be converted to text: it was longer than `maxHtmlLengthToParse`,
     * nested deeper than the converter can handle, or the converter failed. The text of that part is
     * empty, everything else is parsed as usual.
     */
    textConversionError?: Error;
}

/**
 * The `Iconv` class of the `iconv` package, or anything with the same interface.
 */
export interface IconvConstructor {
    new (fromCharset: string, toCharset: string): NodeJS.ReadWriteStream;
}

/**
 * Options for {@link MailParser}. `simpleParser` takes the same options plus `keepCidLinks`.
 */
export interface MailParserOptions {
    /**
     * Do not convert HTML to plain text when the message has no plain text part.
     * @default false
     */
    skipHtmlToText?: boolean;
    /**
     * HTML parts longer than this many characters are not converted to plain text, see
     * {@link MessageText.textConversionError}. No limit by default.
     */
    maxHtmlLengthToParse?: number;
    /**
     * Formats the `Date` header of embedded `message/rfc822` parts in the generated text and HTML.
     * By default `date.toUTCString()` is used.
     */
    formatDateString?: (date: Date) => string;
    /**
     * Do not replace `cid:` links in the HTML when `updateImageLinks()` (and so `simpleParser`) runs.
     * @default false
     */
    skipImageLinks?: boolean;
    /**
     * Do not generate `textAsHtml`, and leave plain text parts out of `html`.
     * @default false
     */
    skipTextToHtml?: boolean;
    /**
     * Do not turn URLs, e-mail addresses and `@mentions` into links in `textAsHtml`.
     * @default false
     */
    skipTextLinks?: boolean;
    /**
     * Treat `message/delivery-status` parts as attachments instead of adding them to the text content.
     * @default false
     */
    keepDeliveryStatus?: boolean;
    /**
     * Decode character sets with the native `iconv` module instead of `iconv-lite`. Pass the
     * `Iconv` class: `{ Iconv: require('iconv').Iconv }`.
     */
    Iconv?: IconvConstructor;
    /**
     * The hash algorithm for attachment checksums, any name `crypto.createHash()` accepts. An algorithm
     * that is not available makes the parser emit an error.
     * @default 'md5'
     */
    checksumAlgo?: string;
    /**
     * The longest the URLs `updateImageLinks()` writes into the HTML may be in total, in characters.
     * References past the limit are left as `cid:` links.
     * @default 20971520 (20 MB)
     */
    maxInlinedImagesSize?: number;
    /**
     * Never parse embedded `message/rfc822` parts, keep every one of them as an attachment.
     * @default false
     */
    ignoreEmbedded?: boolean;
    /**
     * Parse an embedded message unless its disposition says `attachment`. By default only an embedded
     * message with an `inline` disposition is parsed, any other is kept as an attachment.
     * @default false
     */
    defaultInlineEmbedded?: boolean;
    /**
     * The largest header block of one MIME part, in bytes. A larger one makes the parser emit an error.
     * @default 1048576 (1 MB)
     */
    maxHeadSize?: number;
    /**
     * The most MIME parts a message may have. More make the parser emit an error.
     * @default 1000
     */
    maxChildNodes?: number;
}

/**
 * Options for `simpleParser`.
 */
export interface SimpleParserOptions extends MailParserOptions {
    /**
     * Leave `cid:` links in the HTML as they are. By default every `cid:` link to an image attachment
     * is replaced with a `data:` URL of the image.
     * @default false
     */
    keepCidLinks?: boolean;
}

/**
 * The parsed message `simpleParser` resolves with.
 */
export interface ParsedMail {
    /** Every attachment, content buffered. */
    attachments: Attachment[];
    /** Parsed headers of the message, see {@link HeaderValue}. */
    headers: Headers;
    /** The raw header lines of the message. */
    headerLines: HeaderLines;
    /**
     * The HTML content, see {@link MessageText.html}. Unless `keepCidLinks` is set, `cid:` links to
     * image attachments are replaced with `data:` URLs, and the value is `false` when the message has no
     * HTML; with `keepCidLinks` set it is not set instead.
     */
    html?: string | false;
    /** The plain text content, see {@link MessageText.text}. */
    text?: string;
    /** The plain text content converted to HTML, see {@link MessageText.textAsHtml}. */
    textAsHtml?: string;
    /** Why an HTML part could not be converted to text, see {@link MessageText.textConversionError}. */
    textConversionError?: Error;
    /** The `Subject` header. */
    subject?: string;
    /** The `References` header: one Message-ID as a string, more than one as an array. */
    references?: string | string[];
    /** The `Date` header. */
    date?: Date;
    /** The `To` header, an array when the message has more than one `To` header. */
    to?: AddressObject | AddressObject[];
    /** The `From` header. */
    from?: AddressObject;
    /** The `Cc` header, an array when the message has more than one `Cc` header. */
    cc?: AddressObject | AddressObject[];
    /** The `Bcc` header, an array when the message has more than one `Bcc` header. */
    bcc?: AddressObject | AddressObject[];
    /** The `Message-ID` header, angle brackets included. */
    messageId?: string;
    /** The `In-Reply-To` header, angle brackets included. */
    inReplyTo?: string;
    /** The `Reply-To` header. */
    replyTo?: AddressObject;
}

/**
 * A message to parse: the raw message as a Buffer or a string, or a readable stream of it.
 */
export type Source = Buffer | string | Readable;
