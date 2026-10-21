import MailParser from './mail-parser.js';
import simpleParser from './simple-parser.js';
import { parseAddressHeader } from './address-header.js';

export { MailParser, simpleParser, parseAddressHeader };
export type { SimpleParserCallback } from './simple-parser.js';
export type * from './types.js';

export default { MailParser, simpleParser, parseAddressHeader };
