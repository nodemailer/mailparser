# Claude Development Guidelines

## Project Overview

mailparser is an advanced email parsing library for Node.js. It turns raw RFC 822 /
MIME messages into structured JavaScript objects (headers, addresses, subject,
text/HTML bodies, attachments). Everything is handled as a stream, so it can parse
very large messages (100MB+) with relatively low memory overhead.

The library is in **maintenance mode**: it receives security updates and critical
bug fixes only - no new features. For new projects, the successor is
[PostalMime](https://github.com/postalsys/postal-mime) (works in Node.js and the
browser). Keep this in mind when scoping changes: prefer minimal, targeted fixes
over refactors or new functionality.

Published to npm as [`mailparser`](https://www.npmjs.com/package/mailparser).
Homepage and full docs: <https://nodemailer.com/extras/mailparser/>.

## Project Structure

mailparser is written in TypeScript under `src/` and published as a dual package:
ES modules in `dist/esm/` and CommonJS in `dist/cjs/`, each with type declarations.
Both `require('mailparser')` and `import { simpleParser } from 'mailparser'` work.
The layout follows `../nodemailer` and `../imapflow`.

- `src/index.ts` - Public entry point. Named exports `MailParser`, `simpleParser` and
  `parseAddressHeader`, the public types, and a default export object with all three
- `src/address-header.ts` - `parseAddressHeader()` and the address decoding and formatting
  helpers `MailParser` uses for its own address headers (the helpers are `@internal`)
- `src/types.ts` - The public option and result types (`MailParserOptions`,
  `SimpleParserOptions`, `ParsedMail`, `Attachment`, `AttachmentStream`, `MessageText`,
  `Headers`, `HeaderValue`, `AddressObject` and the rest). Keep them accurate to what
  the code produces; the names follow the old `@types/mailparser` where that cost nothing
- `src/vendor-types.d.ts` - Minimal ambient declarations for the runtime dependencies
  that ship without types (`he`, `html-to-text`, `linkify-it`, `punycode.js`). Nothing
  from them may reach the public declarations (`test/package/package-test.ts` checks)
- `src/tlds.cjs` (+ `src/tlds.d.cts`) - Hand-written CommonJS file that loads the `tlds`
  list. The package ships it as `index.json`, which an ES module can only import with an
  import attribute that Node 20 before 20.10 does not parse, so both builds go through
  this file; `scripts/build.js` copies it into `dist/esm` and `dist/cjs`
- `scripts/build.js` - The build: runs `tsc` with `tsconfig.esm.json` and
  `tsconfig.cjs.json`, writes a `package.json` with the module format into each output
  directory, copies `src/tlds.cjs`, and applies the CommonJS interop (below)
- `dist/` - Build output, gitignored; it is what gets published to npm (`files`)
- `/test` - `node:test` suites (`*-test.ts`, run through tsx against `src/`) and `.eml`
  fixtures. `test/package/` checks the built `dist/` output: the exports map, the module
  shapes, the packed file list and the declarations (consumer projects type-checked under
  node16, bundler and node10 resolution); `test/package/cjs-smoke.cjs` is the plain
  CommonJS smoke test
- `/examples` - Standalone usage examples (`.cjs`, not published to npm)
- `/bench` - Benchmark scripts (`.cjs`, not published to npm)

### Public paths

`package.json` `exports` keeps every path that resolved before the TypeScript build:
`mailparser`, `mailparser/index(.js)`, `mailparser/lib/mail-parser(.js)`,
`mailparser/lib/simple-parser(.js)`, `mailparser/lib/stream-hash(.js)` and
`mailparser/package.json`, each with an `import` and a `require` target. `typesVersions`
maps the same deep paths for consumers on the legacy node10 resolution. Never drop one.

The CommonJS build keeps the pre-TypeScript shapes: `require('mailparser')` is an object
whose enumerable keys are `MailParser`, `simpleParser` and `parseAddressHeader` (its `default` is a
non-enumerable alias of the module itself), and the `lib/*` paths return the class or
function directly (`module.exports = exports.default`, with a non-enumerable `.default`).
`scripts/build.js` does that rewrite and fails the build if a default-export module also
grows named runtime exports, so keep `mail-parser.ts`, `simple-parser.ts` and
`stream-hash.ts` default-export only.

### Key Files

- `src/mail-parser.ts` - The `MailParser` Transform stream. Wraps `@zone-eu/mailsplit`
  to walk the MIME tree, decodes headers (`libmime`) and addresses
  (`nodemailer/lib/addressparser`), decodes text bodies through libmime's
  `createDecodeStream()` (or the native `Iconv` option), `format=flowed` text, HTML-to-text conversion
  (`html-to-text`), entity decoding (`he`), and link detection (`linkify-it` +
  `tlds`). This is where almost all parsing logic lives. Processing methods and state
  are tagged `@internal` and stripped from the declarations; the event and `read()`
  signatures live on a merged interface at the end of the file.
- `src/simple-parser.ts` - `simpleParser(input, [options], [callback])` convenience
  wrapper. Buffers a stream/Buffer/string into a single `mail` object and supports
  both callback and Promise styles. Use this for one-shot parsing; use `MailParser`
  directly for streaming.
- `src/stream-hash.ts` - `StreamHash` Transform that computes an attachment checksum
  (default md5) and byte size as content streams through.

## Technology Stack

- **Language**: TypeScript (`tsconfig.base.json`: strict, `exactOptionalPropertyTypes`,
  `erasableSyntaxOnly`, `isolatedModules`, `stripInternal`), compiled twice from the
  same sources. `@types/node` stays on the 20.x line and `typescript` on 6.x
  (`.ncurc.cjs`).
- **Runtime**: Node.js >= 20 (CI tests on 20.x, 22.x, 24.x and latest)
- **Module system**: `"type": "module"` package with a real CommonJS build - see
  Platform constraints below
- **Streaming**: Node `stream.Transform` throughout
- **MIME splitting**: `@zone-eu/mailsplit`
- **MIME/header decoding**: `libmime`, `nodemailer/lib/addressparser`
- **Charset handling**: `libmime` (`createDecodeStream()`, which uses `iconv-lite` and
  `encoding-japanese`); `iconv-lite` is also a devDependency the tests encode fixtures with
- **HTML**: `html-to-text`, `he`, `linkify-it`, `tlds`

## Development Commands

```
npm run build                             # Produce dist/ (also runs on install and before publish via `prepare`)
npm test                                  # Build, then run the suite (tsx + node:test)
node --import tsx --test test/simple-parser-test.ts    # Run a single test file
npm run test:coverage                     # Run the suite under c8
npm run test:cjs                          # CommonJS smoke test of dist/ with require(esm) switched off
npm run typecheck                         # tsc over src/ and test/
npm run lint                              # ESLint (flat config in eslint.config.js), then typecheck
npm run lint:fix                          # ESLint with --fix
npm run format                            # Format all files with Prettier
npm run format:check                      # Check formatting without writing
npm run update                            # Upgrade dependencies (ncu -u), reinstall, regenerate lockfile
```

`npm test` does not lint. CI runs `npm run lint`, `npm run format:check`,
`npm test` and `npm run test:cjs` as separate steps, so run all of them before committing.

## Testing

- Tests live in `/test`, named `*-test.ts`, and use Node's built-in `node:test`
  runner through tsx, against the `src/` sources. Grouped suites use `describe`/`it`,
  flat files use `test`. Event-driven tests take the `(t: TestContext, done)` callback
  form and assert with `t.assert.*` (`strictEqual`, `deepStrictEqual`, `ok`, `ifError`);
  `t.plan(n)` pins the expected assertion count where a test had one. The `TestContext`
  annotation is required: `t.assert` assertion signatures need an explicitly typed `t`.
- Parse results in the behavioural tests are typed `any` on purpose; the public types are
  covered by the consumer type-checks in `test/package/package-test.ts`.
- `test/simple-parser-test.ts` and `test/issue-221-test.ts` load the native `iconv`
  devDependency to exercise the `Iconv` option (declared in `test/types/iconv.d.ts`).
  It is test-only and never ships.
- Test inputs are real and adversarial `.eml` files under `test/fixtures/`. When
  fixing a parser bug, add a fixture that reproduces it plus a regression test,
  following the existing `issue-NNN-test.ts` naming for issue-specific cases.
- The suite is hermetic - no network or external services. CI runs lint (with the
  typecheck), format:check and the suite on Node 20, 22, 24 and latest, plus
  `npm run test:cjs` everywhere but Node 20 (`.github/workflows/test.yml`).

## Architecture Notes

- `MailParser` is a `Transform`: raw bytes are written in, parsed objects
  (`headers`, `data` for text/html, `attachment` for files) are emitted as events
  and as readable objects. It chains `@zone-eu/mailsplit` splitters with per-node
  decoders (`IconvDecoder`, `FlowedDecoder`, `StreamHash`).
- Attachments are streamed, not buffered, so large attachments do not blow up
  memory. `simpleParser` is the exception - it intentionally collects everything
  into one object for convenience.
- Input is always untrusted. A crafted message must never crash the process,
  exhaust memory/CPU (watch for ReDoS in any regex over message content), or
  pollute prototypes. See `SECURITY.md` for the threat model.

## Platform constraints (important)

mailparser is bundled into single-file executables with **[@yao-pkg/pkg]
(https://github.com/yao-pkg/pkg)** by downstream projects (e.g. EmailEngine).
`pkg` snapshots a CommonJS `require()` graph and cannot load ES modules. Two rules
follow:

- **Node.js 20 is the minimum supported version.** Runtime code, tests and tooling
  must work on Node 20, 22 and 24.
- **The package and its entire runtime dependency tree must be genuinely
  CommonJS-loadable**, with `require(esm)` switched off. Node 22+ (and 20.19) load
  ES modules through `require()` by default, which hides an ESM-only dependency
  until the pkg binary fails on it. A CommonJS entry that only wraps a dynamic
  `import()` of ESM code does not count.

What that means in practice:

- The library is authored in TypeScript as ES modules and compiled to a genuine
  CommonJS build in `dist/cjs` (no wrapper around a dynamic `import()`). `main`,
  `types` and every `require` condition of the exports map point there. Do not use
  `import.meta`, top-level `await` or dynamic `import()` in `src/`: the CommonJS build
  has to run the same code. Runtime dependencies are imported as default imports
  (`import he from 'he'`), which works for CommonJS packages in both builds.
- ESLint uses the shared flat config (`eslint.config.js`, the same as
  `../pubface/eslint.config.js`; `src/` also gets the type-aware rules). Keep it
  identical to the other Postal Systems / Nodemailer packages; repo-specific overrides
  go only in its "Repo-specific" block, each with a one-line reason.
- Use static, literal import paths so `pkg` can trace them. Avoid computed or
  conditional paths.
- **Never add or upgrade to a dependency (direct or transitive) that is pure ESM.**
  When a package's newer major version moves to ESM-only, pin the last CommonJS
  major: add its name to the `reject` list in `.ncurc.cjs` (or give it a `target`)
  with a comment giving the reason.
- **Check with `npm run test:cjs`** after any dependency change. It loads the built
  CommonJS entry and every exported path with `NODE_OPTIONS=--no-experimental-require-module`
  and parses a message through every runtime dependency, so any ES module reached
  through `require()` fails with `ERR_REQUIRE_ESM`. CI runs it on Node 22, 24 and
  latest (Node 20 has no such flag).
- pkg follows `require()` of the package root, but its static tracer does not read an
  exports map, so a binary whose only reference is a deep path
  (`require('mailparser/lib/simple-parser')`) leaves `dist/` out. Requiring
  `mailparser` anywhere in the application, as EmailEngine does, includes it.

## Dependency Maintenance

- `npm run update` runs `npm-check-updates` (`ncu -u`, configured via `.ncurc.cjs`),
  wipes `node_modules`/`package-lock.json`, and reinstalls. `.ncurc.cjs` has
  `upgrade: true`, so even a bare `ncu` rewrites `package.json` - run it
  deliberately.
- The `reject` list in `.ncurc.cjs` exists to keep ESM-only releases out (see
  Platform constraints above). Extend it rather than working around a broken upgrade.
- After updating, run `npm test`. Check `npm audit` for **production**
  (`--omit=dev`) advisories; dev-only transitive advisories do not ship to consumers
  and should not be force-fixed if doing so breaks the toolchain. Prefer dropping an
  abandoned devDependency over pinning its subtree (the benchmarks carry their own
  `bench/random-message.cjs` for that reason).
- devDependencies are pinned to exact versions (no `^` or `~`).

## Releases

- Releases are automated with **release-please** (`.github/workflows/release.yaml`,
  `release-please-config.json`). Merging a release PR tags the version and the
  workflow publishes to npm with provenance (`npm publish --provenance`). `npm ci`
  in the publish job runs the `prepare` script, so the tarball always carries a fresh
  `dist/`.
- Commit messages drive versioning - use **Conventional Commits**:
    - `fix:` -> patch release, `feat:` -> minor release.
    - `chore:`, `docs:`, `test:`, `ci:`, `refactor:` etc. do not trigger a release.

## Code Style Rules

- Never use emojis in code or documentation, only printable ASCII characters.
- Use a single hyphen-minus (`-`) as a dash in comments and user-facing strings.
  Never use double hyphens (`--`), em dashes, or en dashes.
- Match the existing style: 4-space indent, single quotes, no trailing commas,
  `printWidth` 160 (enforced by Prettier - see `.prettierrc.cjs`).
- When composing git commit messages, do not include Claude as a co-contributor.
- For commits that do not change runtime behavior (docs, comments, CI/workflow
  tweaks, formatting), append `[skip ci]` to the commit message to avoid triggering
  the GitHub Actions workflows. Exception: do not add `[skip ci]` to commits using a
  `fix:` or `feat:` prefix - those must run so the release workflow is triggered.
- After making code changes:
    1. Run `/simplify` to review changed code for reuse, quality, and efficiency.
    2. Run `npm run format`, `npm run lint` and `npm test`.
    3. Run `/security-review` to check for security issues before committing.
- After pushing, check the GitHub Actions runs for the push (e.g.
  `gh run list --branch master`) and report their status. If a run fails for a
  strange or unrelated reason (for example a checkout step reporting "account
  suspended", HTTP 403, or other auth/infrastructure errors that have nothing to do
  with the change), check <https://www.githubstatus.com/> for an active GitHub
  incident before assuming the failure is caused by the change.

## Related Projects We Maintain

- **@zone-eu/mailsplit** - the MIME splitter mailparser is built on, maintained by
  us. When a parsing bug originates in the split/rewrite layer, fix it there rather
  than working around it in mailparser.
- **libmime**, **nodemailer** - also maintained by us; the same "fix it at the
  source" rule applies.
