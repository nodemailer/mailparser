mailparser
==========

**mailparser** is an asynchronous and non-blocking parser for [node.js](http://nodejs.org) to parse mime encoded e-mail messages. Handles even large
attachments with ease - attachments are parsed in chunks that can be saved into disk or sent to database while parsing (tested with 16MB attachments).

**mailparser** parses raw source of e-mail messages to convert mime-stream into a structured object.

No need to worry about charsets or decoding *quoted-printable* or *base64* data, *mailparser* (with the help of *node-iconv*) does all of it for you. All the textual output from *mailparser* (subject line, addressee names, message body) is always UTF-8.

Requirements
------------

You need to have [node-iconv](http://github.com/bnoordhuis/node-iconv) installed. Update *mime.js* to point to the correct location.

If node-iconv becomes a npm package, I'll make a package from mailparser too.

Usage
-----

Create a new *mailparser* object

    var mp = new MailParser();
    
Set up listener for different events

  * Get mail headers as a structured object
    
        mp.on("header", function(headers){
            console.log(headers);
        });
  
  * Get mail body as a structured object
    
        mp.on("body", function(body){
            console.log(body);
        });
  
  * Get info about binary attachment that is about to start streaming
    
        mp.on("astart", function(id, headers){
            console.log("attachment id" + id +" started);
            console.log(headers);
        });
  
  * Get part of a binary attachment in the form of a Buffer
    
        mp.on("astream", function(id, buffer){
            console.log("attachment id" + id);
            console.log(buffer);
        });
  
  * Attachment parsing completed
  
        mp.on("aend", function(id){
            console.log("attachment " + id + " finished");
        });

Feed the parser with data

    mp.feed(part1_of_the_message);
    mp.feed(part2_of_the_message);
    mp.feed(part3_of_the_message);
    ...
    mp.feed(partN_of_the_message);

Finish the feeding

    mp.end();
    
Outcome
-------

Parser returns the headers object with *"header"* event and it's structured like this

    { useMime: true
    , contentType: 'multipart/alternative'
    , charset: 'us-ascii'
    , format: 'fixed'
    , multipart: true
    , mimeBoundary: 'Apple-Mail-2-1061547935'
    , messageId: 'BAFE6D0E-AE53-4698-9072-AD1C9BF966AB@gmail.com'
    , messageDate: 1286458909000
    , receivedDate: 1286743827944
    , contentTransferEncoding: '7bit'
    , addressesFrom: 
       [ { address: 'andris.reinman@gmail.com'
         , name: 'Andris Reinman'
         }
       ]
    , addressesReplyTo: []
    , addressesTo: [ { address: 'andris@kreata.ee', name: false } ]
    , addressesCc: []
    , subject: 'Simple test message with special characters like  \u0161 and \u00f5'
    , priority: 3
    }

Message body is returned with the *"body"* event and is structured like this

    { bodyText: 'Mail message as plain text',
    , bodyHTML: 'Mail message as HTML',
    , bodyAlternate: ["list of additional text/* parts of the message"],
    , attachments: ["list of attachments"]
    }

Attachments are included full size in the *body* object if the attachments are textual. Binary attachments
are sent to the client as a stream that can be saved into disk if needed (events *"astream"* and *"aend"*), only the attachment meta-data is included in the *body* object this way.

See *test.js* for an actual usage example (parses the source from *mail.txt* and outputs to console)

    node test.js

You need to install node-iconv and update the path for it in mime.js before running the test!

NB!
---

Messages with attachments are typically formatted as *nested multipart* messages. This means that the *bodyText* and *bodyHTML*
fields might be left blank. Search for an alternate with content-type *multipart* from the bodyAlternate array and use the bodyText and bodyHTML defined there instead.

LICENSE
-------

**BSD**