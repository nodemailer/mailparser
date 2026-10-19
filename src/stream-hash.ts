import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';

/**
 * The object StreamHash records its results on.
 */
export interface HashTarget {
    checksum?: string;
    size?: number;
}

/**
 * A pass-through stream that records the checksum and byte size of what flows through it on the
 * given object once the stream ends. Throws when the hash algorithm is not available.
 */
class StreamHash extends Transform {
    attachment: HashTarget;
    algo: string;
    hash: crypto.Hash;
    byteCount: number;

    constructor(attachment: HashTarget, algo?: string) {
        super();
        this.attachment = attachment;
        this.algo = (algo || 'md5').toLowerCase();
        this.hash = crypto.createHash(this.algo);
        this.byteCount = 0;
    }

    override _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
        this.hash.update(chunk);
        this.byteCount += chunk.length;
        done(null, chunk);
    }

    override _flush(done: TransformCallback): void {
        this.attachment.checksum = this.hash.digest('hex');
        this.attachment.size = this.byteCount;
        done();
    }
}

export default StreamHash;
