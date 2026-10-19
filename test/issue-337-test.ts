import { test } from 'node:test';
import { simpleParser } from '../src/index.js';

test('Hangs when Reply-To invalid encoded', async () => {
    await simpleParser('Content-type: text/plain\r\nReply-To: =?U� -8?B?0=D0=BA=D0=BE=D0=B2?=\n\r\n1234');
});
