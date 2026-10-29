# mailparser

![Nodemailer](https://raw.githubusercontent.com/nodemailer/nodemailer/master/assets/nm_logo_200x136.png)

> [!IMPORTANT]
> This module is in maintenance mode. It will continue to receive security updates and critical bug fixes, but no new features or feature changes will be added. For new projects, please consider using [PostalMime](https://github.com/postalsys/postal-mime), which works in both Node.js and browser environments.

Advanced email parser for Node.js. Everything is handled as a stream which should make it able to parse even very large messages (100MB+) with relatively low overhead.

## Installation

First install the module from npm:

```
$ npm install mailparser
```

next import the `mailparser` object into your script:

```js
const mailparser = require('mailparser');
```

or, from an ES module or TypeScript (type declarations are included):

```js
import { simpleParser, MailParser, parseAddressHeader, parseOtpToken } from 'mailparser';
```

## Usage

See [mailparser homepage](https://nodemailer.com/extras/mailparser/) for documentation and terms.

### Parsing an address header

`parseAddressHeader(value, [options])` parses the value of an address header (`From`, `To`, `Cc`, `Reply-To` and the like) into the same `{ value, html, text }` object `MailParser` and `simpleParser` produce for one, for when the header comes from somewhere else than a message being parsed, for example an IMAP `HEADER.FIELDS` fetch.

```js
const { parseAddressHeader } = require('mailparser');

parseAddressHeader('=?utf-8?Q?J=C3=B5geva?= <info@xn--mnchen-3ya.example>, Team: a@example.com;');
// {
//   value: [
//     { address: 'info@münchen.example', name: 'Jõgeva' },
//     { name: 'Team', group: [{ address: 'a@example.com', name: '' }] }
//   ],
//   html: '<span class="mp_address_group">...',
//   text: '"Jõgeva" <info@münchen.example>, "Team": a@example.com;'
// }
```

- **value** - the header value without the `Name:` prefix, as a string. Folded lines are fine, raw 8-bit bytes have to be decoded into the string first. An array of values (a repeated header) is parsed one value at a time and the addresses are listed in order. An empty or missing value gives an empty list
- **options.flatten** - if `true`, every group is replaced with its members and the group names are dropped, so `value` lists mailboxes only

Each entry of `value` has a `name` (an empty string when there is none, encoded words decoded) and either an `address` (a punycode domain decoded to Unicode) or, for a group, a `group` list of the same entries. RFC 2047 does not allow encoded words in the address itself, so an address part hiding one is kept only when it decodes to a plain `local@domain`, otherwise `address` is an empty string; a display name that decodes to something looking like an address stays a name.

### One-time passcodes

A message with an `OTP-Token` header ([draft-goto-otp-token](https://datatracker.ietf.org/doc/draft-goto-otp-token/), the header Nodemailer sets with its `otp` option) gets an `otp` property on the `simpleParser` result and on the `MailParser` instance, an object with `code` (the passcode) and `origin` (the origin it is bound to, such as `"https://example.com"`).

```js
const mail = await simpleParser('OTP-Token: "123456"; origin="https://example.com"\r\nSubject: Code\r\n\r\nYour code is 123456');
// mail.otp: { code: '123456', origin: 'https://example.com' }
```

`otp` is set only when the message header has exactly one `OTP-Token` header and its value is valid: a structured field String with an `origin` parameter holding a canonical `https` origin, or an `http` origin on a loopback host. An `OTP-Token` header of a MIME part or a forwarded message is ignored. The header is not authenticated, so check that the message carries a valid DKIM signature from the domain of the origin before offering the code. The header comes from an Internet-Draft, so `otp` is experimental and may change in a minor release when the draft does.

For a header that comes from somewhere else than a message being parsed, such as an IMAP `HEADER.FIELDS` fetch or a provider API, `parseOtpToken(values)` takes the raw values of every `OTP-Token` header of the message's own header section (a string or an array) and returns the same `{ code, origin }` object, or `undefined`. The same rules apply, so more than one value returns `undefined`.

```js
const { parseOtpToken } = require('mailparser');

parseOtpToken(['"123456"; origin="https://example.com"']);
// { code: '123456', origin: 'https://example.com' }
```

### Character sets

Text bodies are decoded with libmime's `createDecodeStream()`, which resolves charset aliases, decodes the Japanese charsets iconv-lite does not support (ISO-2022-JP and friends) and keeps a multibyte character that is split across chunks intact. A body in a charset that is not known, or one that is refused, is decoded as UTF-8 with invalid bytes replaced by U+FFFD, the same fallback encoded words in headers get. The refused charsets are UTF-7 (and its aliases), which can carry markup past a filter that looks for `<` (`+ADw-script+AD4-` decodes to `<script>`), and the base64 and hex transfer encodings. A UTF-7 body therefore keeps its `+ADw-` sequences as literal text. The refusal applies with the `Iconv` option as well.

### Attachment checksums

Every attachment gets a `checksum` (hex, md5 unless the `checksumAlgo` option names another algorithm `crypto.createHash()` accepts) and a `size`. Set `checksumAlgo: false` to skip hashing altogether, for example where MD5 is not available (FIPS mode) or the checksum is not used. `checksum` is then not set on the attachments, `size` still is.

### Limits

- `simpleParser` replaces `cid:` image references in the HTML with `data:` URLs. The total length of the URLs written into the HTML is capped by the `maxInlinedImagesSize` option (default 20 MB, counted in characters of the inserted URLs). References past the cap stay as `cid:` links. The same cap applies to URLs returned from a custom `updateImageLinks()` callback.
- `simpleParser` calls its callback, or settles its promise, exactly once. When `MailParser` reports a non-fatal error and then finishes parsing, that error is what the caller receives.
- HTML that can not be converted to text (longer than `maxHtmlLengthToParse`, nested deeper than 1000 levels, or rejected by html-to-text) does not fail the message. `text` is empty, `html` is kept, and the reason is set as `textConversionError` on the result (and on the `text` object `MailParser` emits).

### License

Licensed under MIT
