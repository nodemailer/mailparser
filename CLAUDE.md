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

- `index.js` - Public entry point, exports `{ MailParser, simpleParser }`
- `/lib` - Library source
- `/test` - Nodeunit-style tests and `.eml` fixtures
- `/examples` - Standalone usage examples (not published to npm)
- `/bench` - Benchmark scripts (not published to npm)

### Key Files

- `lib/mail-parser.js` - The `MailParser` Transform stream. Wraps `@zone-eu/mailsplit`
  to walk the MIME tree, decodes headers (`libmime`) and addresses
  (`nodemailer/lib/addressparser`), handles charset conversion (`iconv-lite`,
  `encoding-japanese`), `format=flowed` text, HTML-to-text conversion
  (`html-to-text`), entity decoding (`he`), and link detection (`linkify-it` +
  `tlds`). This is where almost all parsing logic lives.
- `lib/simple-parser.js` - `simpleParser(input, [options], [callback])` convenience
  wrapper. Buffers a stream/Buffer/string into a single `mail` object and supports
  both callback and Promise styles. Use this for one-shot parsing; use `MailParser`
  directly for streaming.
- `lib/stream-hash.js` - `StreamHash` Transform that computes an attachment checksum
  (default md5) and byte size as content streams through.

## Technology Stack

- **Runtime**: Node.js (CI tests on 22.x and 24.x)
- **Module system**: CommonJS only (`require`/`module.exports`) - see Packaging below
- **Streaming**: Node `stream.Transform` throughout
- **MIME splitting**: `@zone-eu/mailsplit`
- **MIME/header decoding**: `libmime`, `nodemailer/lib/addressparser`
- **Charset handling**: `iconv-lite`, `encoding-japanese`
- **HTML**: `html-to-text`, `he`, `linkify-it`, `tlds`

## Development Commands

```
npm test          # Run the full suite: ESLint + nodeunit tests (via Grunt)
npm run format    # Format all code with Prettier
npm run update    # Upgrade dependencies (ncu -u), reinstall, regenerate lockfile
```

There is no separate `lint` script - linting runs as the first Grunt task inside
`npm test`. To lint only, run `npx grunt eslint`.

## Testing

- Tests live in `/test`, named `*-test.js`, and use the **nodeunit** style
  (`exports['name'] = test => { ...; test.equal(...); test.done(); }`).
- `npm test` runs `grunt`, which runs `eslint:all` then `nodeunit:all`
  (`test/**/*-test.js`). Lint failures fail the build before tests run.
- Test inputs are real and adversarial `.eml` files under `test/fixtures/`. When
  fixing a parser bug, add a fixture that reproduces it plus a regression test,
  following the existing `issue-NNN-test.js` naming for issue-specific cases.
- The suite is hermetic - no network or external services. Run `npm test` locally
  before pushing; CI runs the same command on Node 22 and 24.

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

## Packaging and Distribution (important)

mailparser is bundled into single-file executables with **[@yao-pkg/pkg]
(https://github.com/yao-pkg/pkg)** by downstream projects (e.g. EmailEngine).
`pkg` performs static analysis of `require()` calls and cannot bundle pure ESM.
Therefore this package and its entire dependency tree **must stay
CommonJS-compatible**:

- The library is authored in CommonJS (`require`/`module.exports`). Do not convert
  it to ESM, and do not introduce `import`/`export` syntax, top-level `await`,
  dynamic `import()`, or `import.meta`.
- ESLint is configured for `sourceType: 'script'` and `ecmaVersion: 2017`; keep new
  code within that syntax level so it lints and stays broadly compatible.
- Use static, literal `require()` paths so `pkg` can trace them. Avoid computed or
  conditional require paths.
- **Never add a dependency (direct or transitive) that is pure ESM.** When updating
  dependencies, if a package's newer major version moves to ESM-only, pin it back
  and add its name to the `reject` list in `.ncurc.js` (which documents why). After
  any dependency change, run `npm test` to confirm nothing broke.

## Dependency Maintenance

- `npm run update` runs `npm-check-updates` (`ncu -u`, configured via `.ncurc.js`),
  wipes `node_modules`/`package-lock.json`, and reinstalls. `.ncurc.js` has
  `upgrade: true`, so even a bare `ncu` rewrites `package.json` - run it
  deliberately.
- The `reject` list in `.ncurc.js` exists to keep ESM-only releases out (see
  Packaging above). Extend it rather than working around a broken upgrade.
- After updating, run `npm test`. Check `npm audit` for **production**
  (`--omit=dev`) advisories; dev-only transitive advisories (e.g. from the Grunt
  test tooling) do not ship to consumers and should not be force-fixed if doing so
  breaks the toolchain.

## Releases

- Releases are automated with **release-please** (`.github/workflows/release.yaml`,
  `release-please-config.json`). Merging a release PR tags the version and the
  workflow publishes to npm with provenance (`npm publish --provenance`).
- Commit messages drive versioning - use **Conventional Commits**:
    - `fix:` -> patch release, `feat:` -> minor release.
    - `chore:`, `docs:`, `test:`, `ci:`, `refactor:` etc. do not trigger a release.

## Code Style Rules

- Never use emojis in code or documentation, only printable ASCII characters.
- Use a single hyphen-minus (`-`) as a dash in comments and user-facing strings.
  Never use double hyphens (`--`), em dashes, or en dashes.
- Match the existing style: CommonJS, 4-space indent, single quotes, no trailing
  commas, `printWidth` 160 (enforced by Prettier - see `.prettierrc.js`).
- When composing git commit messages, do not include Claude as a co-contributor.
- For commits that do not change runtime behavior (docs, comments, CI/workflow
  tweaks, formatting), append `[skip ci]` to the commit message to avoid triggering
  the GitHub Actions workflows. Exception: do not add `[skip ci]` to commits using a
  `fix:` or `feat:` prefix - those must run so the release workflow is triggered.
- After making code changes:
    1. Run `/simplify` to review changed code for reuse, quality, and efficiency.
    2. Run `npm run format` and `npm test` (lint runs inside `npm test`).
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
