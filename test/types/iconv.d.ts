// The native iconv module is a test-only devDependency without type declarations
declare module 'iconv' {
    const iconv: {
        Iconv: new (fromCharset: string, toCharset: string) => NodeJS.ReadWriteStream;
    };
    export default iconv;
}
