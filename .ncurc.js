'use strict';

module.exports = {
    upgrade: true,
    // mailparser ships inside @yao-pkg/pkg binaries (via EmailEngine and other
    // downstream projects), so every dependency must stay CommonJS-compatible.
    // Reject any package whose newer releases moved to pure ESM - pkg cannot
    // bundle ESM-only modules. Add the offending package name here when an
    // upgrade flips it to ESM.
    reject: [
        // linkify-it 6.0.0 changed the CommonJS export shape (named bindings instead of
        // the constructor) and stopped linkifying bare domains such as example.com or
        // www.example.org by default, which silently breaks autolinking when converting
        // plain text bodies to HTML. Stay on 5.x.
        'linkify-it',
        // he 2.0.0 is ESM-only (exports only src/he.mjs) and requires Node >=22. require('he')
        // throws ERR_REQUIRE_ESM on Node 20 before 20.19, which mailparser still supports, and
        // pkg cannot bundle it. 1.2.0 is the last CommonJS release.
        'he'
    ]
};
