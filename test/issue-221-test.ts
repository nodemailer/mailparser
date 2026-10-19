import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { simpleParser } from '../src/index.js';
import iconvModule from 'iconv';

const { Iconv } = iconvModule;

test('Does it finish?', (t: TestContext, done) => {
    let source = Buffer.concat([
        Buffer.from(
            `From: Mail Delivery Subsystem <postmaster@gems.invalid.local>
To: <bn-5b50cb6e953d170b24983019-42074@invalid.local>
MIME-Version: 1.0
Content-Type: multipart/report; report-type=delivery-status;
	boundary="w7TItYs4100793.1535568934/foo.invalid.local"
Subject: Returned mail: see transcript for details
Auto-Submitted: auto-generated (failure)

This is a MIME-encapsulated message

--w7TItYs4100793.1535568934/foo.invalid.local
Content-Type: message/delivery-status

Reporting-MTA: dns; foo.invalid.local
Received-From-MTA: DNS; invalid.local
Arrival-Date: Wed, 29 Aug 2018 11:55:34 -0700

Final-Recipient: RFC822; bar@invalid.local
Action: failed
Status: 5.1.1

--w7TItYs4100793.1535568934/foo.invalid.local
`.replace(/\n/g, '\r\n')
        )
    ]);

    simpleParser(source, { Iconv }, (err, mail: any) => {
        t.assert.ifError(err);
        t.assert.ok(mail);
        t.assert.ok(mail.headers.get('subject').trim());

        done();
    });
});
