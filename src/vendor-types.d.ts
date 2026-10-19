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

declare module 'linkify-it' {
    namespace LinkifyIt {
        interface Match {
            index: number;
            lastIndex: number;
            text: string;
            url: string;
        }
        interface Rule {
            validate(text: string, pos: number, self: LinkifyIt): number | boolean;
            normalize(match: Match): void;
        }
    }
    interface LinkifyIt {
        // compiled patterns, including the source fragments rules build on
        re: Record<string, any>;
        tlds(list: string | string[], keepOld?: boolean): this;
        add(schema: string, definition: string | LinkifyIt.Rule | null): this;
        set(options: { fuzzyIP?: boolean; fuzzyLink?: boolean; fuzzyEmail?: boolean }): this;
        pretest(text: string): boolean;
        match(text: string): LinkifyIt.Match[] | null;
    }
    function LinkifyIt(): LinkifyIt;
    export default LinkifyIt;
}
