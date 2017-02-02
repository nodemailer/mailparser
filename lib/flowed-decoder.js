'use strict';

// Helper class to rewrite nodes with specific mime type

const Transform = require('stream').Transform;
const libmime = require('libmime');

/**
 * Really bad "stream" transform to parse format=flowed content
 *
 * @constructor
 * @param {String} delSp True if delsp option was used
 */
class FlowedDecoder extends Transform {
    constructor(options) {
        super();
        this.options = options || {};

        this.chunks = [];
        this.chunklen = 0;
    }

    _transform(chunk, encoding, callback) {
        if (!chunk || !chunk.length) {
            return callback();
        }

        if (!encoding !== 'buffer') {
            chunk = Buffer.from(chunk, encoding);
        }

        this.chunks.push(chunk);
        this.chunklen += chunk.length;

        callback();
    }

    _flush(callback) {
        if (this.chunklen) {
            let currentBody = Buffer.concat(this.chunks, this.chunklen);
            let content = libmime.decodeFlowed(currentBody.toString('binary'), this.options.delSp);
            this.push(Buffer.from(content, 'binary'));
        }
        return callback();
    }
}

module.exports = FlowedDecoder;
