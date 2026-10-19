'use strict';

// The tlds package ships its list as index.json. An ES module can only import JSON with an import
// attribute, which Node.js 20 before 20.10 does not parse, so both builds load the list through
// this CommonJS file instead: require() reads JSON on every Node.js version, and `import` of a
// CommonJS module gives its module.exports as the default export. scripts/build.js copies it next
// to the compiled modules.
module.exports = require('tlds');
