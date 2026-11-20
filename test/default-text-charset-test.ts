import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simpleParser } from '../src/index.js';

// mailparser#480: a text body whose Content-Type names no charset, written in Latin-1
function message(contentType: string): Buffer {
    return Buffer.from(`Content-Type: ${contentType}\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nCertificado de Servi=E7o, Gest=E3o\r\n`, 'latin1');
}

describe('defaultTextCharset option', () => {
    it('decodes a text body without a charset as UTF-8 by default', async () => {
        let parsed = await simpleParser(message('text/plain'));
        assert.equal(parsed.text, 'Certificado de Servi�o, Gest�o\n');
    });

    it('decodes a text body without a charset from the named charset', async () => {
        let parsed = await simpleParser(message('text/plain'), { defaultTextCharset: 'windows-1252' });
        assert.equal(parsed.text, 'Certificado de Serviço, Gestão\n');

        parsed = await simpleParser(message('text/html'), { defaultTextCharset: 'latin1' });
        assert.equal(parsed.html, 'Certificado de Serviço, Gestão\n');
    });

    it('does not override a charset the body declares', async () => {
        let parsed = await simpleParser(message('text/plain; charset=iso-8859-2'), { defaultTextCharset: 'utf-8' });
        assert.equal(parsed.text, 'Certificado de Serviço, Gestăo\n');
    });
});
