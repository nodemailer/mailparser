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
 * given object once the stream ends. Throws when the hash algorithm is not available. With `algo`
 * set to `false` nothing is hashed and only the size is recorded.
 */
class StreamHash extends Transform {
    attachment: HashTarget;
    algo: string | false;
    hash: crypto.Hash | null;
    byteCount: number;

    constructor(attachment: HashTarget, algo?: string | false) {
        super();
        this.attachment = attachment;
        this.algo = algo === false ? false : (algo || 'md5').toLowerCase();
        this.hash = this.algo === false ? null : crypto.createHash(this.algo);
        this.byteCount = 0;
    }

    override _transform(chunk: Buffer, encoding: BufferEncoding, done: TransformCallback): void {
        this.hash?.update(chunk);
        this.byteCount += chunk.length;
        done(null, chunk);
    }

    override _flush(done: TransformCallback): void {
        if (this.hash) {
            this.attachment.checksum = this.hash.digest('hex');
        }
        this.attachment.size = this.byteCount;
        done();
    }
}

export default StreamHash;
