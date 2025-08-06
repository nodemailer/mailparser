'use strict';

const { MailParser } = require('../index');
const fs = require('fs');
const emailFile = process.argv[2] || 'examples/simple.eml';

console.log('=== Configuration Options ===\n');

// 1. Traditional Mode (default)
const traditional = new MailParser(); // streamText: false (default)

traditional.on('data', (data) => {
    if (data.type === 'text') {
        console.log('   📝 Final aggregated text:', data.text);
    }
});

// 2. Streaming Mode
const streaming = new MailParser({ streamText: true });

streaming.on('data', (data) => {
    if (data.type === 'text') {
        console.log(`   🚀 Stream part (${data.contentType}):`);
        data.content.pipe(process.stdout);
        data.content.on('end', () => console.log(' [stream ended]'));
    }
});

// Test both
if (fs.existsSync(emailFile)) {
    console.log(`\nParsing ${emailFile}...\n`);
    
    fs.createReadStream(emailFile).pipe(traditional);
    
    setTimeout(() => {
        fs.createReadStream(emailFile).pipe(streaming);
    }, 100);
} else {
    console.error(`File not found: ${emailFile}`);
}