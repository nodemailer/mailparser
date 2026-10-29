import type { HeaderLines, Otp } from './types.js';

// Parser for the OTP-Token header of draft-goto-otp-token-01, an Internet-Draft that expires
// on 25 March 2027. By then check for a newer revision of the draft or a published RFC, the
// header name and its parameters are still open questions in the draft.
//
// The header value is a structured field item (RFC 9651): a String holding the passcode,
// with an `origin` parameter naming the origin the passcode is bound to. Unknown parameters
// are ignored, but they still have to be valid, otherwise the whole field fails to parse.

// RFC 9651 lets a parser limit the size of a field. A passcode and an origin take well under
// a kilobyte, the limit keeps the regular expressions below away from megabyte inputs
const MAX_FIELD_LENGTH = 8192;

type Cursor = { input: string; pos: number };

// The bare item syntax of RFC 9651 4.2.3.1, keyed by the first character of the item. An
// Integer has at most 15 digits, a Decimal at most 12 before and 1 to 3 after the dot, and a
// Date is an Integer. Whatever follows a match is left for the caller, which only accepts a
// parameter separator or the end of the field, so a 16th digit or a 4th decimal fails there
const NUMBER = /-?(?:\d{1,12}\.\d{1,3}|\d{1,15})/y;
const STRING = /"((?:[\x20\x21\x23-\x5b\x5d-\x7e]|\\["\\])*)"/y;
const TOKEN = /[A-Za-z*][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*/y;
const BYTE_SEQUENCE = /:[A-Za-z0-9+/=]*:/y;
const BOOLEAN = /\?[01]/y;
const DATE = /@-?\d{1,15}/y;
const DISPLAY_STRING = /%"((?:[\x20\x21\x23\x24\x26-\x7e]|%[0-9a-f]{2})*)"/y;
const KEY = /[a-z*][a-z0-9_\-.*]*/y;
const SPACES = / */y;

// Matches the sticky expression at the cursor and moves past it, returns null if it does not match
function match(cursor: Cursor, re: RegExp): RegExpExecArray | null {
    re.lastIndex = cursor.pos;
    const result = re.exec(cursor.input);
    if (result) {
        cursor.pos = re.lastIndex;
    }
    return result;
}

// RFC 9651 4.2.5, returns the unescaped String or null if there is no valid String at the cursor
function parseString(cursor: Cursor): string | null {
    const result = match(cursor, STRING);
    return result && result[1].replace(/\\(["\\])/g, '$1');
}

// RFC 9651 4.2.10. The percent encoded bytes must be valid UTF-8, which decodeURIComponent
// checks as it decodes them
function isDisplayString(cursor: Cursor): boolean {
    const result = match(cursor, DISPLAY_STRING);
    if (!result) {
        return false;
    }
    try {
        decodeURIComponent(result[1]);
        return true;
    } catch {
        return false;
    }
}

// RFC 9651 4.2.3.1. Returns the value of a String, true for any other valid bare item and
// false for an invalid one
function parseBareItem(cursor: Cursor): string | boolean {
    const c = cursor.input.charAt(cursor.pos);
    switch (c) {
        case '"':
            return parseString(cursor) ?? false;
        case ':':
            return !!match(cursor, BYTE_SEQUENCE);
        case '?':
            return !!match(cursor, BOOLEAN);
        case '@':
            return !!match(cursor, DATE);
        case '%':
            return isDisplayString(cursor);
    }
    return !!match(cursor, c === '-' || (c >= '0' && c <= '9') ? NUMBER : TOKEN);
}

/**
 * Parses a structured field item (RFC 9651 4.2 with field_type "item") whose bare item is a
 * String. Returns the String and the String parameters, or null if the value does not parse
 * or the bare item is of another type. A parameter of any other type is stored as true
 * @internal
 */
export function parseStringItem(value: string): { value: string; params: Map<string, string | true> } | null {
    const cursor: Cursor = { input: value, pos: 0 };
    match(cursor, SPACES);

    const item = parseString(cursor);
    if (item === null) {
        return null;
    }

    // a later parameter with the same key replaces the earlier one
    const params = new Map<string, string | true>();
    while (cursor.input[cursor.pos] === ';') {
        cursor.pos++;
        match(cursor, SPACES);
        const key = match(cursor, KEY);
        if (!key) {
            return null;
        }
        let paramValue: string | boolean = true;
        if (cursor.input[cursor.pos] === '=') {
            cursor.pos++;
            paramValue = parseBareItem(cursor);
            if (paramValue === false) {
                return null;
            }
        }
        params.set(key[0], paramValue);
    }

    match(cursor, SPACES);
    return cursor.pos === cursor.input.length ? { value: item, params } : null;
}

/**
 * Checks that the origin is the canonical ASCII serialization of a potentially trustworthy
 * origin, as the draft requires: https, or http on a loopback host
 * @internal
 */
export function isOtpOrigin(origin: string): boolean {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }

    // the URL parser lowercases the host, converts it to punycode and drops the default port, so
    // a value that is not canonical, or has a path, userinfo or an opaque origin, does not match
    // its own origin. The WHATWG parser lets characters such as a quote or a brace into a host,
    // which the origin grammar (RFC 6454) does not allow, so only a DNS name, an IPv4 address or a
    // bracketed IPv6 address is accepted
    if (url.origin !== origin || !/^([a-z0-9_-]+\.)*[a-z0-9_-]+$|^\[[0-9a-f:.]+\]$/.test(url.hostname)) {
        return false;
    }

    const isLoopback = /^(localhost|.+\.localhost|127(\.\d+){3}|\[::1\])$/.test(url.hostname);
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback);
}

// The field name with its colon. A line with whitespace before the colon is not counted, it
// is obsolete syntax (RFC 5322 4.5) the draft has no reason to accept
const OTP_HEADER = /^otp-token:/i;

/**
 * Returns the value of a header without its line breaks and the whitespace around it, or null if
 * the value is longer than the field size limit
 */
function getFieldValue(value: string): string | null {
    // unfolding removes the line breaks and keeps the whitespace that follows them (RFC 5322 2.2.3)
    value = value.replace(/\r?\n/g, '');
    let start = 0;
    let end = value.length;
    while (start < end && (value[start] === ' ' || value[start] === '\t')) {
        start++;
    }
    while (end > start && (value[end - 1] === ' ' || value[end - 1] === '\t')) {
        end--;
    }
    return end - start > MAX_FIELD_LENGTH ? null : value.slice(start, end);
}

/**
 * Returns the one-time passcode from the values of the `OTP-Token` headers of a message header
 * section, following the receiver steps of the draft (section 3.2), or undefined if there is no
 * valid one. Pass every `OTP-Token` value of the message's own header section, not of a MIME
 * part: more than one makes the message have none. The values are the raw ones, with any
 * folding left in and no encoded words decoded
 */
export function parseOtpToken(values: string | string[] | undefined): Otp | undefined {
    const list = typeof values === 'string' ? [values] : values;
    if (!Array.isArray(list) || list.length !== 1 || typeof list[0] !== 'string') {
        return undefined;
    }

    const value = getFieldValue(list[0]);
    const parsed = value === null ? null : parseStringItem(value);
    const origin = parsed?.params.get('origin');

    // an empty passcode is valid syntax, but there is nothing in it to fill in
    if (!parsed?.value || typeof origin !== 'string' || !isOtpOrigin(origin)) {
        return undefined;
    }

    return { code: parsed.value, origin };
}

/**
 * Returns the one-time passcode from the OTP-Token header of a message, or undefined if the
 * message has no valid one. Only the header of the message itself counts, the draft has an
 * OTP-Token in a MIME part ignored
 * @internal
 */
export function getOtp(headerLines: HeaderLines): Otp | undefined {
    const values = headerLines.filter(({ line }) => OTP_HEADER.test(line)).map(({ line }) => line.slice(line.indexOf(':') + 1));
    return values.length ? parseOtpToken(values) : undefined;
}
