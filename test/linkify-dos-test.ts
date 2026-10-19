import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { simpleParser, MailParser } from '../src/index.js';

// Bodies that used to stall linkification. Every one of these blocked the event
// loop for seconds before the scan was bounded, so they are measured
// synchronously - the assertion is reached whatever textToHtml does, unlike a
// wall-clock check collected inside a parser callback which is never reached
// while the event loop is blocked. Each one is left as plain text now, so it
// costs single-digit milliseconds while unbounded scanning needs upwards of
// fifteen seconds. The limit sits far from both and cannot go flaky on a slow
// machine. Shapes that the bounded scan does spend real time on are asserted on
// their result instead of on the clock, see the budget tests below.
const STALL_LIMIT = 2000;
const stallers = {
    // linkify-it is quadratic in the length of a single whitespace-free run
    'separator-heavy run': 'http://a.b/c?d='.repeat(32000),
    // ...and exponential in the number of "xn--" labels it has to regroup
    'punycode label chain': 'xn--a.'.repeat(27) + 'xn',
    // a length limit alone does not help, these runs all stay under it
    'many sub-limit label chains': ('xn--a.'.repeat(16) + 'xn ').repeat(1200),
    // trailing whitespace trimming used to rescan every space run per position
    'interior whitespace run': 'a' + ' '.repeat(120000) + 'b'
};

test('Crafted text bodies must not stall linkification', (t: TestContext, done) => {
    Object.keys(stallers).forEach(name => {
        let parser: any = new MailParser({});
        let start = Date.now();
        parser.textToHtml(stallers[name as keyof typeof stallers]);
        let elapsed = Date.now() - start;
        t.assert.ok(elapsed < STALL_LIMIT, name + ' took ' + elapsed + 'ms, expected under ' + STALL_LIMIT + 'ms');
    });

    done();
});

test('Linkification budget is shared by all text parts', (t: TestContext, done) => {
    // A per-call budget would let a multipart message multiply it by part count.
    // Counting links rather than timing keeps this a statement about the budget
    // instead of about how fast the machine running it is. The labels chain up
    // to just inside the per-segment limit, so a few parts use up the budget.
    let body = ('xn--a.'.repeat(6) + 'xn https://example.com/a ').repeat(8000);
    let countLinks = (html: string) => (html.match(/<a href=/g) || []).length;

    let perPart = countLinks(new MailParser({}).textToHtml(body));

    let shared = new MailParser({});
    let sharedTotal = 0;
    for (let i = 0; i < 8; i++) {
        sharedTotal += countLinks(shared.textToHtml(body));
    }

    t.assert.ok(perPart > 0, 'a part on its own gets linkified');
    t.assert.ok(sharedTotal * 2 < 8 * perPart, '8 parts of one message linkified ' + sharedTotal + ' links, 8 separate messages would get ' + 8 * perPart);
    done();
});

test('A body of cheap segments still runs out of budget', (t: TestContext, done) => {
    // a per-segment length limit alone does not bound the scan - every run here
    // stays well under it, only the work budget stops them from adding up
    let runs = 2000;
    let body = ('http://a.b/#'.repeat(170) + ' ').repeat(runs);
    let links = (new MailParser({}).textToHtml(body).match(/<a href=/g) || []).length;

    t.assert.ok(links > 0, 'the runs at the start are linkified');
    t.assert.ok(links < runs / 4, 'scanning stopped after ' + links + ' of ' + runs + ' runs');
    done();
});

test('Linkification of the same text is reproducible', (t: TestContext, done) => {
    // the scan budget has to be deterministic, a wall-clock one would make the
    // same message linkify differently from run to run
    let body = ('xn--a.'.repeat(8) + 'xn https://example.com/a ').repeat(4000);
    let runs = [];

    for (let i = 0; i < 3; i++) {
        runs.push((new MailParser({}).textToHtml(body).match(/<a href=/g) || []).length);
    }

    t.assert.ok(runs[0] > 0, 'some links are found');
    t.assert.strictEqual(runs[0], runs[1], 'run 1 and 2 found ' + runs[0] + ' vs ' + runs[1] + ' links');
    t.assert.strictEqual(runs[0], runs[2], 'run 1 and 3 found ' + runs[0] + ' vs ' + runs[2] + ' links');
    done();
});

test('Segment scanning finds the same links as scanning the whole text', (t: TestContext, done) => {
    // the scan runs on whitespace-delimited segments, so anything linkify-it
    // treats as part of a link must not be mistaken for a segment separator
    let cases = [
        // U+FEFF is whitespace to Javascript but a link character to linkify-it
        ['go pay\uFEFFpal.com now', ['http://pay\uFEFFpal.com']],
        ['mail bob@exam\uFEFFple.org today', ['mailto:bob@exam\uFEFFple.org']],
        // angle brackets are allowed inside paths and in the userinfo part
        ['Docs: http://example.com/wiki/Foo_(bar<baz) ok', ['http://example.com/wiki/Foo_(bar<baz)']],
        ['http://svc<token@api.example.com/v1/resource', ['http://svc<token@api.example.com/v1/resource']],
        // ...and a link may not start or end at one, so these have no links
        ['go example.com<foo end', []],
        ['Meeting notes at example.com.<see attachment>', []],
        ['Contact @support<support@example.com> today', ['mailto:support@example.com']],
        // U+FF5C terminates a host for linkify-it but is not whitespace
        ['サポート｜example.com｜ support@example.com', ['http://example.com', 'mailto:support@example.com']],
        // every mention on a line is linkified, no matter how many precede it
        ['Hi @alice, ping @bob about it. Thanks, @carol', ['https://twitter.com/alice', 'https://twitter.com/bob', 'https://twitter.com/carol']],
        // ...except "@@mention", which is not a mention
        ['Say @@bob hello', []]
    ];

    let parser: any = new MailParser({});
    cases.forEach(entry => {
        let html = parser.textToHtml(entry[0]);
        let found = (html.match(/<a href="[^"]*"/g) || []).map((tag: string) => tag.slice(9, -1));
        t.assert.deepStrictEqual(found, entry[1], JSON.stringify(entry[0]));
    });

    done();
});

// [body, substrings the output must contain, substrings it must not contain]
const bodies = [
    ['Visit http://example.com/page?a=1 or mail bob@example.org thanks', ['<a href="http://example.com/page?a=1">', '<a href="mailto:bob@example.org">'], []],
    // dots in a path or query are cheap, only chained host labels are not
    ['Get https://cdn.example.com/a/v1.2.3/lib.min.js.map?v=1.2.3 now', ['<a href="https://cdn.example.com/a/v1.2.3/lib.min.js.map?v=1.2.3">'], []],
    // splitting only at whitespace means a paragraph without spaces stays a
    // single segment, so the segment limit has to clear ordinary CJK prose
    ['これはテストです。'.repeat(320) + 'https://example.com/news/2026', ['<a href="https://example.com/news/2026">'], []],
    // a run longer than the segment limit is kept as plain text, not dropped
    ['http://example.com/' + 'p'.repeat(5000), ['http://example.com/' + 'p'.repeat(5000)], ['<a href=']]
];

test('Ordinary bodies parse as expected', (t: TestContext, done) => {
    let pending = bodies.length;

    bodies.forEach(entry => {
        let source = Buffer.from('Content-Type: text/plain; charset=utf-8\r\n\r\n' + entry[0]);
        simpleParser(source, {}, (err, mail: any) => {
            t.assert.ifError(err);
            (entry[1] as string[]).forEach(expected => t.assert.ok(mail.textAsHtml.indexOf(expected) >= 0, 'missing ' + JSON.stringify(expected.slice(0, 60))));
            (entry[2] as string[]).forEach(banned => t.assert.ok(mail.textAsHtml.indexOf(banned) < 0, 'unexpected ' + JSON.stringify(banned.slice(0, 60))));
            if (!--pending) {
                return done();
            }
        });
    });
});

test('A failing text conversion ends the stream instead of hanging it', (t: TestContext, done) => {
    let parser: any = new MailParser({});
    parser.getTextContent = () => {
        throw new Error('Failed to build text content');
    };

    parser.on('data', () => false);
    parser.on('error', (err: Error) => {
        t.assert.strictEqual(err.message, 'Failed to build text content');
        // reporting the error without completing _flush would leave the stream
        // open forever, so check that it actually got torn down
        setTimeout(() => {
            t.assert.ok(parser.destroyed, 'stream must be destroyed, not left hanging');
            done();
        }, 50);
    });

    parser.end(Buffer.from('Content-Type: text/plain\r\n\r\nhello'));
});
