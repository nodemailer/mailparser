import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mailparser, { parseAddressHeader, simpleParser } from '../src/index.js';
import { createRandom, PROPERTY_ITERATIONS, PROPERTY_SEED } from './helpers/random.js';
import type { Random } from './helpers/random.js';

const b64word = (text: string) => '=?utf-8?B?' + Buffer.from(text).toString('base64') + '?=';

describe('parseAddressHeader', () => {
    it('is exported as a named export and on the default export', () => {
        assert.equal(typeof parseAddressHeader, 'function');
        assert.equal(mailparser.parseAddressHeader, parseAddressHeader);
    });

    it('parses mailboxes into value, html and text', () => {
        assert.deepEqual(parseAddressHeader('"Doe, John" <john@example.com>, jane@example.com'), {
            value: [
                { address: 'john@example.com', name: 'Doe, John' },
                { address: 'jane@example.com', name: '' }
            ],
            html:
                '<span class="mp_address_group"><span class="mp_address_name">Doe, John</span> &lt;<a href="mailto:john@example.com" class="mp_address_email">john@example.com</a>&gt;</span>, ' +
                '<span class="mp_address_group"><a href="mailto:jane@example.com" class="mp_address_email">jane@example.com</a></span>',
            text: '"Doe, John" <john@example.com>, jane@example.com'
        });
    });

    it('decodes encoded words in display names', () => {
        let parsed = parseAddressHeader('=?utf-8?Q?J=C3=B5geva?= <a@example.com>, =?ISO-8859-1?Q?Andr=E9?= <b@example.com>');
        assert.deepEqual(parsed.value, [
            { address: 'a@example.com', name: 'Jõgeva' },
            { address: 'b@example.com', name: 'André' }
        ]);
        assert.equal(parsed.text, '"Jõgeva" <a@example.com>, "André" <b@example.com>');
    });

    it('keeps a display name that decodes to an address a display name', () => {
        assert.deepEqual(parseAddressHeader(b64word('attacker@evil.com')).value, [{ address: '', name: 'attacker@evil.com' }]);
        assert.deepEqual(parseAddressHeader(b64word('"CEO" <ceo@bank.com>') + ' <real@sender.example>').value, [
            { address: 'real@sender.example', name: '"CEO" <ceo@bank.com>' }
        ]);
    });

    it('rejects an encoded word inside the address part unless it decodes to a plain address', () => {
        // decodes to "ceo@bank.com> <x" - not a plain local@domain, so the address is dropped
        assert.deepEqual(parseAddressHeader('Name <' + b64word('ceo@bank.com> <x') + '@evil.example>').value, [{ address: '', name: 'Name' }]);
        assert.deepEqual(parseAddressHeader('<' + b64word('a b') + '@example.com>').value, [{ address: '', name: '' }]);
        // a plain address hidden in an encoded word is kept decoded
        assert.deepEqual(parseAddressHeader('Name <' + b64word('user@example.com') + '>').value, [{ address: 'user@example.com', name: 'Name' }]);
    });

    it('decodes punycode domains to Unicode', () => {
        let parsed = parseAddressHeader('Muenchen <info@xn--mnchen-3ya.example>, other@xn--bcher-kva.example');
        assert.deepEqual(parsed.value, [
            { address: 'info@münchen.example', name: 'Muenchen' },
            { address: 'other@bücher.example', name: '' }
        ]);
        assert.match(parsed.html, /mailto:info@m&#xFC;nchen\.example/);
    });

    it('parses groups and decodes their members', () => {
        let parsed = parseAddressHeader(
            '=?utf-8?Q?T=C3=B6=C3=B6?=: a@xn--mnchen-3ya.example, =?utf-8?Q?B=C3=B5?= <b@example.com>;, Undisclosed recipients:;, c@example.com'
        );
        assert.deepEqual(parsed.value, [
            {
                name: 'Töö',
                group: [
                    { address: 'a@münchen.example', name: '' },
                    { address: 'b@example.com', name: 'Bõ' }
                ]
            },
            { name: 'Undisclosed recipients', group: [] },
            { address: 'c@example.com', name: '' }
        ]);
        assert.equal(parsed.text, '"Töö": a@münchen.example, "Bõ" <b@example.com>;, "Undisclosed recipients": ;, c@example.com');
        assert.match(parsed.html, /^<span class="mp_address_group"><span class="mp_address_name">T&#xF6;&#xF6;: <\/span>/);
    });

    it('keeps a punycode domain as it is with decodePunycode: false, groups included', () => {
        const header = 'a@xn--mnchen-3ya.de, Team: b@xn--mnchen-3ya.de;';
        const addresses = (parsed: ReturnType<typeof parseAddressHeader>) =>
            parsed.value.map(entry => entry.address || entry.group?.map(member => member.address));

        assert.deepEqual(addresses(parseAddressHeader(header)), ['a@m\u00fcnchen.de', ['b@m\u00fcnchen.de']]);
        assert.deepEqual(addresses(parseAddressHeader(header, { decodePunycode: false })), ['a@xn--mnchen-3ya.de', ['b@xn--mnchen-3ya.de']]);
        assert.deepEqual(parseAddressHeader(header, { decodePunycode: false, flatten: true }).value, [
            { address: 'a@xn--mnchen-3ya.de', name: '' },
            { address: 'b@xn--mnchen-3ya.de', name: '' }
        ]);
    });

    it('builds html and text only when read, as ordinary enumerable values', () => {
        const parsed = parseAddressHeader('"Doe, John" <john@example.com>');
        assert.deepEqual(Object.keys(parsed), ['value', 'html', 'text']);
        assert.equal(parsed.text, '"Doe, John" <john@example.com>');
        assert.equal(parsed.html, parsed.html, 'read twice, the same value');
        assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { value: parsed.value, html: parsed.html, text: parsed.text });
    });

    it('flattens groups into their members with the flatten option', () => {
        let parsed = parseAddressHeader('Team: a@example.com, ' + b64word('Bob') + ' <b@example.com>;, Empty:;, c@example.com', { flatten: true });
        assert.deepEqual(parsed.value, [
            { address: 'a@example.com', name: '' },
            { address: 'b@example.com', name: 'Bob' },
            { address: 'c@example.com', name: '' }
        ]);
        assert.equal(parsed.text, 'a@example.com, "Bob" <b@example.com>, c@example.com');
    });

    it('parses every value of a repeated header on its own', () => {
        // the unterminated group of the first value does not swallow the second one
        let parsed = parseAddressHeader(['Group: a@example.com', 'b@example.com']);
        assert.deepEqual(parsed.value, [
            { name: 'Group', group: [{ address: 'a@example.com', name: '' }] },
            { address: 'b@example.com', name: '' }
        ]);
    });

    it('accepts folded values', () => {
        assert.deepEqual(parseAddressHeader('First <a@example.com>,\r\n Second\r\n\t<b@example.com>').value, [
            { address: 'a@example.com', name: 'First' },
            { address: 'b@example.com', name: 'Second' }
        ]);
    });

    it('returns an empty list for an empty or missing value', () => {
        for (let value of ['', null, undefined, [], ['', null]] as const) {
            assert.deepEqual(parseAddressHeader(value as any), { value: [], html: '', text: '' });
        }
    });

    it('escapes values in html and quotes names in text', () => {
        let parsed = parseAddressHeader('"<b>\\"x\\"</b>" <a&b@example.com>');
        assert.deepEqual(parsed.value, [{ address: 'a&b@example.com', name: '<b>"x"</b>' }]);
        assert.ok(!parsed.html.includes('<b>'));
        assert.match(parsed.html, /&#x3C;b&#x3E;/);
        assert.equal(parsed.text, '"<b>\\"x\\"</b>" <a&b@example.com>');
    });

    it('does not let a crafted name pollute prototypes', () => {
        let parsed = parseAddressHeader('__proto__ <a@example.com>, constructor: b@example.com;');
        assert.equal(parsed.value[0]!.name, '__proto__');
        assert.equal(({} as any).address, undefined);
    });
});

describe('parseAddressHeader properties', () => {
    const NAME_CHARS = 'abcXYZ019 .,;:<>@"\\()[]õäöüÕ中文한국\u{1F600}';
    const LOCAL_CHARS = 'abcxyz019._+-';

    function randomMailbox(random: Random): string {
        let address = random.string(LOCAL_CHARS, random.int(1, 12)) + '@' + random.pick(['example.com', 'xn--mnchen-3ya.example', 'sub.example.org']);
        switch (random.int(0, 3)) {
            case 0:
                return address;
            case 1:
                return '<' + address + '>';
            case 2:
                return b64word(random.string(NAME_CHARS, random.int(1, 20))) + ' <' + address + '>';
            default:
                return '"' + random.string(NAME_CHARS, random.int(1, 20)).replace(/["\\]/g, '\\$&') + '" <' + address + '>';
        }
    }

    function randomHeader(random: Random): string {
        let entries: string[] = [];
        let count = random.int(1, 6);
        for (let i = 0; i < count; i++) {
            if (random.next() < 0.2) {
                let members: string[] = [];
                let memberCount = random.int(0, 3);
                for (let j = 0; j < memberCount; j++) {
                    members.push(randomMailbox(random));
                }
                entries.push(random.string('abcGroup', random.int(1, 8)) + ': ' + members.join(', ') + ';');
            } else {
                entries.push(randomMailbox(random));
            }
        }
        return entries.join(random.pick([', ', ',\r\n ', ',']));
    }

    it('gives what simpleParser gives for the same header', async () => {
        let checks: Promise<void>[] = [];
        for (let i = 1; i <= PROPERTY_ITERATIONS * 5; i++) {
            let random = createRandom(PROPERTY_SEED + i);
            let header = randomHeader(random);
            let at = `case ${i} (PROPERTY_SEED=${PROPERTY_SEED}): ${JSON.stringify(header)}`;
            checks.push(
                simpleParser(Buffer.from('To: ' + header + '\r\nSubject: test\r\n\r\nbody')).then((mail: any) => {
                    assert.deepEqual(parseAddressHeader(header), mail.to, at);
                })
            );
        }
        await Promise.all(checks);
    });

    it('flattening lists exactly the mailboxes of the grouped result', () => {
        let mailboxes = (list: any[]): any[] => list.flatMap(entry => (entry.group ? mailboxes(entry.group) : [entry]));
        for (let i = 1; i <= PROPERTY_ITERATIONS * 5; i++) {
            let random = createRandom(PROPERTY_SEED + i);
            let header = randomHeader(random);
            assert.deepEqual(parseAddressHeader(header, { flatten: true }).value, mailboxes(parseAddressHeader(header).value), JSON.stringify(header));
        }
    });
});
