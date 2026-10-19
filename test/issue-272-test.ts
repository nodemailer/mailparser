import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { simpleParser } from '../src/index.js';

test('Throws TypeError with input === null', async (t: TestContext) => {
    try {
        simpleParser(null as any);

        throw Error('Error not thrown.');
    } catch (error: any) {
        t.assert.strictEqual(error.constructor.name, 'TypeError');
    }
});

test('Throws TypeError with input === undefined', async (t: TestContext) => {
    try {
        simpleParser(undefined as any);

        throw Error('Error not thrown.');
    } catch (error: any) {
        t.assert.strictEqual(error.constructor.name, 'TypeError');
    }
});

test('Throws TypeError without input', async (t: TestContext) => {
    try {
        (simpleParser as any)();

        throw Error('Error not thrown.');
    } catch (error: any) {
        t.assert.strictEqual(error.constructor.name, 'TypeError');
    }
});
