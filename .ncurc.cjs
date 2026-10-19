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
    ],
    target: name => {
        // @types/node stays on the 20.x line so the compiler rejects APIs that do
        // not exist on Node 20, the oldest version the test suite runs on
        if (name === '@types/node') {
            return 'minor';
        }
        // typescript-eslint declares a peer range that excludes TypeScript 7
        if (name === 'typescript') {
            return 'minor';
        }
        // iconv-lite 1.0 (in alpha since 2026-10) requires Node 22 and moves to ES modules, relying on
        // require(esm). That breaks the Node 20 floor and the CommonJS-only rule EmailEngine's pkg
        // binary depends on, so stay on 0.x: 'minor' still takes new 0.x releases.
        if (name === 'iconv-lite') {
            return 'minor';
        }
        return 'latest';
    }
};
