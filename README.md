mailparser
==========

**mailparser** is an asynchronous and non-blocking parser for [node.js](http://nodejs.org) to parse mime encoded e-mail messages. Handles even large
attachments with ease - attachments are parsed in chunks that can be saved into disk or sent to database while parsing.

**mailparser** parses raw source of e-mail messages to convert mime-stream into a structured object.

Requirements
------------

You need to have [node-iconv](http://github.com/bnoordhuis/node-iconv) installed. Update *mime.js* to point to the correct location.

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