import { test } from 'node:test';
import type { TestContext } from 'node:test';
import fs from 'node:fs';
import { simpleParser } from '../src/index.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('Parses message/delivery-status', async (t: TestContext) => {
    let encodedText = fs.readFileSync(__dirname + '/fixtures/delivery-status.eml');
    let mail = Buffer.from(encodedText);
    let parsed: any = await simpleParser(mail);
    t.assert.ok(parsed.text.indexOf('Status: 5.1.1') >= 0);
});
