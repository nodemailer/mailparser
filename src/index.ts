import MailParser from './mail-parser.js';
import simpleParser from './simple-parser.js';
import { parseAddressHeader } from './address-header.js';
import { parseOtpToken } from './otp-token.js';

export { MailParser, simpleParser, parseAddressHeader, parseOtpToken };
export type { SimpleParserCallback } from './simple-parser.js';
export type * from './types.js';

export default { MailParser, simpleParser, parseAddressHeader, parseOtpToken };
