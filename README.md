# mailparser

![Nodemailer](https://raw.githubusercontent.com/nodemailer/nodemailer/master/assets/nm_logo_200x136.png)

Advanced email parser for Node.js. Everything is handled as a stream which should make it able to parse even very large messages (100MB+) with relatively low overhead.

## Installation

### Free, EUPL-licensed version

First install the module from npm:

```
$ npm install mailparser
```

next import the `mailparser` object into your script:

```js
const mailparser = require('mailparser');
```

### MIT version

MIT-licensed version is available for [Postal Systems subscribers](https://postalsys.com/).

First install the module from Postal Systems private registry:

```
$ npm install @postalsys/mailparser
```

next import the `mailparser` object into your script:

```js
const mailparser = require('@postalsys/mailparser');
```

If you have already built your application using the free version of mailparser and do not want to modify require statements in your code, you can install the MIT-licensed version as an alias for "mailparser".

```
$ npm install mailparser@npm:@postalsys/mailparser
```

This way you can keep using the old module name

```js
const mailparser = require('mailparser');
```

## Usage

See [mailparser homepage](https://nodemailer.com/extras/mailparser/) for documentation and terms.

### License

Licensed under European Union Public Licence (EUPL) v1.1 or later.

MIT-licensed version of mailparser is available for [Postal Systems subscribers](https://postalsys.com/).
