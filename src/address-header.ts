import he from 'he';
import libmime from 'libmime';
import addressparser from 'nodemailer/lib/addressparser';
import punycode from 'punycode.js';
import type { AddressObject, EmailAddress, ParseAddressHeaderOptions } from './types.js';

// An RFC 2047 encoded word
const ENCODED_WORD = /[=]\?[^?]+\?[BbQq]\?[^?]*\?[=]/;

/**
 * Decodes the addresses addressparser produced, in place: encoded words in display names, an
 * internationalized (punycode) domain, and the members of a group.
 *
 * @internal
 */
export function decodeAddresses(addresses: EmailAddress[], decoder: { decodeWords(str: string): string } = libmime): void {
    for (let address of addresses) {
        address.name = (address.name || '').toString().trim();

        // An encoded word decodes into the display name and nothing else, whatever it
        // decodes to. RFC 2047 section 5 keeps encoded words out of the addr-spec, so a
        // name that decodes to "CEO" <ceo@bank.com> is still only a name: parsing it
        // again would report an address the header never carried
        if (address.name) {
            try {
                address.name = decoder.decodeWords(address.name);
            } catch {
                //ignore, keep as is
            }
        }
        // Security fix: detect RFC 2047 encoded-words in the address field.
        // Per RFC 2047 Section 5, encoded-words MUST NOT appear in addr-spec.
        // If found, decode and validate; reject if result is not a simple local@domain.
        if (address.address && ENCODED_WORD.test(address.address)) {
            try {
                let decodedAddr = decoder.decodeWords(address.address);
                if (/^[^\s@]+@[^\s@]+$/.test(decodedAddr) && !/[=]\?/.test(decodedAddr)) {
                    address.address = decodedAddr;
                } else {
                    address.address = '';
                }
            } catch {
                address.address = '';
            }
        }
        if (address.address && /@xn--/.test(address.address)) {
            try {
                address.address =
                    address.address.slice(0, address.address.lastIndexOf('@') + 1) +
                    punycode.toUnicode(address.address.slice(address.address.lastIndexOf('@') + 1));
            } catch {
                // Not a valid punycode string; keep as is
            }
        }
        if (address.group) {
            decodeAddresses(address.group, decoder);
        }
    }
}

/**
 * Formats parsed addresses for an HTML context, every value HTML-escaped.
 *
 * @internal
 */
export function formatAddressesHTML(value: EmailAddress | EmailAddress[]): string {
    let formatSingleLevel = (addresses: EmailAddress[]): string =>
        addresses
            .map(address => {
                let str = '<span class="mp_address_group">';
                if (address.name) {
                    str += '<span class="mp_address_name">' + he.encode(address.name) + (address.group ? ': ' : '') + '</span>';
                }
                if (address.address) {
                    let link = '<a href="mailto:' + he.encode(address.address) + '" class="mp_address_email">' + he.encode(address.address) + '</a>';
                    if (address.name) {
                        str += ' &lt;' + link + '&gt;';
                    } else {
                        str += link;
                    }
                }
                if (address.group) {
                    str += formatSingleLevel(address.group) + ';';
                }
                return str + '</span>';
            })
            .join(', ');
    return formatSingleLevel(([] as EmailAddress[]).concat(value || []));
}

/**
 * Formats parsed addresses as plain text, display names quoted.
 *
 * @internal
 */
export function formatAddressesText(value: EmailAddress | EmailAddress[]): string {
    let formatSingleLevel = (addresses: EmailAddress[]): string =>
        addresses
            .map(address => {
                let str = '';
                if (address.name) {
                    // a quoted-string, so a quote or backslash inside the name is escaped
                    str += `"${address.name.replace(/["\\]/g, '\\$&')}"` + (address.group ? ': ' : '');
                }
                if (address.address) {
                    let link = address.address;
                    if (address.name) {
                        str += ' <' + link + '>';
                    } else {
                        str += link;
                    }
                }
                if (address.group) {
                    str += formatSingleLevel(address.group) + ';';
                }
                return str;
            })
            .join(', ');
    return formatSingleLevel(([] as EmailAddress[]).concat(value || []));
}

/**
 * Parses the value of an address header (`From`, `To`, `Cc`, `Reply-To` and the like) into the
 * {@link AddressObject} `MailParser` and `simpleParser` produce for one: display names have their
 * encoded words decoded, an internationalized (punycode) domain is decoded to Unicode, and an
 * address part that hides an encoded word is dropped unless it decodes to a plain `local@domain`
 * (RFC 2047 keeps encoded words out of the address, so `=?utf-8?B?...?=@example.com` naming
 * another address is not taken at its word).
 *
 * The value is the header value without the `Name:` prefix, as a string. Line folding may be left
 * in. Raw 8-bit bytes have to be decoded into the string first, eg. `buffer.toString('utf-8')`.
 * Several values (a header that occurs more than once) can be given as an array: each is parsed
 * on its own and the addresses are listed in order.
 *
 * @param value The header value, or several of them
 * @param options See {@link ParseAddressHeaderOptions}
 */
export function parseAddressHeader(value: string | string[] | null | undefined, options?: ParseAddressHeaderOptions): AddressObject {
    let addresses: EmailAddress[] = [];
    for (let entry of ([] as Array<string | null | undefined>).concat(value)) {
        if (typeof entry !== 'string' || !entry) {
            continue;
        }
        let parsed = addressparser(entry, { flatten: !!options?.flatten }) as unknown as EmailAddress[];
        decodeAddresses(parsed);
        for (let address of parsed) {
            addresses.push(address);
        }
    }
    return {
        value: addresses,
        html: formatAddressesHTML(addresses),
        text: formatAddressesText(addresses)
    };
}
