// mulberry32, a small seeded PRNG (the one libmime's property tests use), so a failing property
// case can be reproduced from its seed. Not for anything but reproducible test input

// PROPERTY_SEED and PROPERTY_ITERATIONS rerun a reported failure or make a longer soak run
export const PROPERTY_SEED = Number(process.env.PROPERTY_SEED) || 20261021;
export const PROPERTY_ITERATIONS = Number(process.env.PROPERTY_ITERATIONS) || 40;

export function createRandom(seed: number) {
    /* eslint-disable no-bitwise */
    let state = seed >>> 0;
    let next = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    /* eslint-enable no-bitwise */
    let int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
    let pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
    return {
        next,
        int,
        pick,
        /** A string of `length` characters drawn from `alphabet`, by code point */
        string(alphabet: string, length: number): string {
            let chars = Array.from(alphabet);
            let out = '';
            for (let i = 0; i < length; i++) {
                out += pick(chars);
            }
            return out;
        }
    };
}

export type Random = ReturnType<typeof createRandom>;
