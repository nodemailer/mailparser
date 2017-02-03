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
            html: '<span class="mp_address_name">Andris Reinman</span> &lt;<a href="mailto:andris+123@kreata.ee" class="mp_address_email">andris+123@kreata.ee</a>&gt;, <a href="mailto:andris.reinman@gmail.com" class="mp_address_email">andris.reinman@gmail.com</a>',
            text: 'Andris Reinman <andris+123@kreata.ee>, andris.reinman@gmail.com'
        });
        test.done();
    });
};
