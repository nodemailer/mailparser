'use strict';

const simpleParser = require('..').simpleParser;
const fs = require('fs');

module.exports['Parse message'] = test => {
    simpleParser(fs.createReadStream(__dirname + '/fixtures/nodemailer.eml'), (err, mail) => {
        test.ifError(err);
        test.ok(mail);
        test.equal(mail.attachments.length, 4);
        test.equal(mail.attachments[2].checksum, '2822cbcf68de083b96ac3921d0e308a2');
        test.ok(mail.html.indexOf('data:image/png;base64,iVBORw0KGgoAAAANSU') >= 0);
        test.equal(mail.subject, 'Nodemailer is unicode friendly ✔ (1476358788189)');
        test.deepEqual(mail.to, {
            value: [
                // keep indent
                {
                    address: 'andris+123@kreata.ee',
                    name: 'Andris Reinman'
                },
                {
                    address: 'andris.reinman@gmail.com',
                    name: ''
                }
            ],
            html:
                '<span class="mp_address_group"><span class="mp_address_name">Andris Reinman</span> &lt;<a href="mailto:andris+123@kreata.ee" class="mp_address_email">andris+123@kreata.ee</a>&gt;</span>, <span class="mp_address_group"><a href="mailto:andris.reinman@gmail.com" class="mp_address_email">andris.reinman@gmail.com</a></span>',
            text: 'Andris Reinman <andris+123@kreata.ee>, andris.reinman@gmail.com'
        });
        test.done();
    });
};

module.exports['Parse message with large plaintext content'] = test => {
    simpleParser(fs.createReadStream(__dirname + '/fixtures/large_text.eml'), (err, mail) => {
        test.ifError(err);

        test.ok(mail);
        test.ok(mail.textAsHtml);
        test.ok(mail.text);
        test.ok(!mail.html);

        test.done();
    });
};

module.exports['Parse spam message'] = test => {
    simpleParser(fs.createReadStream(__dirname + '/fixtures/spam.eml'), (err, mail) => {
        test.ifError(err);
        test.ok(mail);
        test.ok(mail.html.trim());
        test.done();
    });
};
