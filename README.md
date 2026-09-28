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

## Usage

See [mailparser homepage](https://nodemailer.com/extras/mailparser/) for documentation and terms.

### Limits

- `simpleParser` replaces `cid:` image references in the HTML with `data:` URLs. The total length of the URLs written into the HTML is capped by the `maxInlinedImagesSize` option (default 20 MB, counted in characters of the inserted URLs). References past the cap stay as `cid:` links. The same cap applies to URLs returned from a custom `updateImageLinks()` callback.
- `simpleParser` calls its callback, or settles its promise, exactly once. When `MailParser` reports a non-fatal error (for example HTML longer than `maxHtmlLengthToParse`), that error is what the caller receives. `MailParser` itself still emits the `'error'` event and then finishes parsing.

### License

Licensed under MIT
