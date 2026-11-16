// Minimal ambient declarations for the runtime dependencies that ship without types. Only what
// mailparser calls is declared, and none of it reaches the public declarations.

declare module 'he' {
    interface EncodeOptions {
        useNamedReferences?: boolean;
    }
    const he: {
        encode(text: string, options?: EncodeOptions): string;
    };
    export default he;
}

declare module 'punycode.js' {
    const punycode: {
        toUnicode(input: string): string;
    };
    export default punycode;
}

declare module 'html-to-text' {
    export function htmlToText(html: string, options?: { limits?: { maxDepth?: number } }): string;
}
