// Builds the package.
//
// 1. Compiles src/ twice with tsc: once as ES modules into dist/esm and once as
//    CommonJS into dist/cjs. Each output directory gets its own package.json
//    that pins the module format, and src/tlds.cjs is copied into both.
// 2. Rewrites the CommonJS files that only have a default export so that
//    `require()` keeps returning the exported class or function itself, the
//    same shape the pre-TypeScript CommonJS sources had:
//    require('mailparser/lib/mail-parser') is the MailParser class and
//    require('mailparser/lib/simple-parser') the simpleParser function.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = require.resolve('typescript/bin/tsc');

function runTsc(project, ...args) {
    const result = spawnSync(process.execPath, [tsc, '-p', project, ...args], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

function listFiles(dir, ext) {
    return fs
        .readdirSync(dir, { recursive: true })
        .filter(name => name.endsWith(ext))
        .map(name => path.join(dir, name));
}

// The entry point is the one module that combines a default export with named
// runtime exports. It keeps its named exports, and its default export is made to
// be the exports object itself. Before the TypeScript build `require('mailparser')`
// had no default export, so `import mailparser from 'mailparser'` in a CommonJS
// compiled consumer resolved to the exports object, and a test double installed
// through either import style was seen by the other. Pointing `default` at the
// exports object keeps that. The alias is non-enumerable so that the enumerable
// keys of the module are MailParser and simpleParser, as before.
const ENTRY_POINT_MODULE = 'index.js';
const ENTRY_POINT_SHIM = "Object.defineProperty(exports, 'default', { value: exports, enumerable: false, writable: true, configurable: true });\n";

// tsc emits `exports.default = X` for `export default X`. For modules whose only
// runtime export is the default one, make `require()` return X directly. The
// default export stays reachable as a non-enumerable `.default` property, which
// is what TypeScript and Babel generated `import X from '...'` code reads.
//
// Any other module that has a default export and named runtime exports can not
// get this treatment, so the build fails for one: silently switching `require()`
// from the class to the exports object would break `require('mailparser/lib/...')`
// callers.
function applyCjsInterop(dir) {
    const namedExport = /\bexports\.(?!default\b)[A-Za-z_$][\w$]*\s*=/;
    const definedExport = /Object\.defineProperty\(exports,\s*"(?!__esModule")/;
    const starExport = /__exportStar\(/;
    const defaultExport = /\bexports\.default\s*=/;

    for (const file of listFiles(dir, '.js')) {
        const source = fs.readFileSync(file, 'utf8');
        if (!defaultExport.test(source)) {
            continue;
        }
        const name = path.relative(dir, file);
        if (name === ENTRY_POINT_MODULE) {
            writePatched(file, source, ENTRY_POINT_SHIM);
            continue;
        }
        if (namedExport.test(source) || definedExport.test(source) || starExport.test(source)) {
            throw new Error(
                name +
                    ' has a default export and named runtime exports. Keep default-export modules default-only ' +
                    '(attach extra values as properties of the exported function or class)'
            );
        }
        const shim =
            'module.exports = exports.default;\n' +
            "Object.defineProperty(module.exports, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });\n";
        writePatched(file, source, shim);
    }
}

// Appends a shim to a compiled module, ahead of the source map comment if there is one
function writePatched(file, source, shim) {
    const mapComment = source.lastIndexOf('//# sourceMappingURL=');
    const patched = mapComment === -1 ? source + shim : source.slice(0, mapComment) + shim + source.slice(mapComment);
    fs.writeFileSync(file, patched);
}

function build() {
    fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });

    runTsc('tsconfig.esm.json');
    // The ES module compile has already type-checked the same sources
    runTsc('tsconfig.cjs.json', '--noCheck');

    fs.writeFileSync(path.join(root, 'dist', 'esm', 'package.json'), JSON.stringify({ type: 'module' }, null, 4) + '\n');
    fs.writeFileSync(path.join(root, 'dist', 'cjs', 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 4) + '\n');

    applyCjsInterop(path.join(root, 'dist', 'cjs'));

    // Hand-written CommonJS helpers that tsc does not copy, see src/tlds.cjs
    for (const format of ['esm', 'cjs']) {
        fs.copyFileSync(path.join(root, 'src', 'tlds.cjs'), path.join(root, 'dist', format, 'tlds.cjs'));
    }
}

build();
