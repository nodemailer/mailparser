'use strict';

// Picks a pseudo-random .eml file from a directory tree laid out as <root>/YYYY-MM/*.eml and
// returns it as a stream. The seed makes the choice repeatable between benchmark runs.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

const listings = new Map();

function list(dir, filter) {
    if (!listings.has(dir)) {
        listings.set(
            dir,
            fs.readdirSync(dir).filter(name => filter.test(name))
        );
    }
    return listings.get(dir);
}

module.exports.get = (rootdir, seed) => {
    let output = new PassThrough();
    let hash = crypto
        .createHash('sha1')
        .update(seed || crypto.randomBytes(10))
        .digest('hex');

    let folders;
    try {
        folders = list(rootdir, /^\d{4}-\d{2}$/);
    } catch (err) {
        setImmediate(() => output.emit('error', err));
        return output;
    }
    if (!folders.length) {
        output.end();
        return output;
    }
    let folder = path.join(rootdir, folders[parseInt(hash.substr(0, 8), 16) % folders.length]);
    let messages = list(folder, /\.eml$/);
    if (!messages.length) {
        output.end();
        return output;
    }

    let input = fs.createReadStream(path.join(folder, messages[parseInt(hash.substr(-8), 16) % messages.length]));
    input.on('error', err => output.emit('error', err));
    return input.pipe(output);
};
