
/**
 * @fileOverview This is the main file for the MailParser library to parse raw e-mail data
 * @author <a href="mailto:andris@node.ee">Andris Reinman</a>
 * @version 0.2.3
 */

var Stream = require("stream").Stream,
    utillib = require("util"),
    mimelib = require("mimelib"),
    datetime = require("./datetime"),
    Iconv = require("iconv").Iconv,
    Streams = require("./streams"),
    crypto = require("crypto");

// Expose to the world
module.exports.MailParser = MailParser;

// MailParser is a FSM - it is always in one of the possible states
var STATES = {
    header:   0x1,
    body:     0x2,
    finished: 0x3
};

/**
 * Creates instance of MailParser which in turn extends Stream
 * 
 * @constructor
 * @param {Object} [options] Optional options object
 */
function MailParser(options){
    
    // Make MailParser a Stream object
    Stream.call(this);
    this.writable = true;
    
    /** @private*/ this.options = options || {};
     
    /** @private */ this.state         = STATES.header;
    /** @private */ this.remainder     = "";
    /** @public  */ this.mimeTree      = this.createMimeNode();
    /** @private */ this.currentNode   = this.mimeTree;
    /** @private */ this.fileNames     = {};
    /** @private */ this.multipartTree = [];
    /** @private */ this.iconv         = {};
    /** @private */ this.mailData      = {};
}
// inherit methods and properties of Stream
utillib.inherits(MailParser, Stream);

/**
 * Writes a value to the MailParser stream
 * 
 * @param {Buffer|String} chunk The data to be written to the MailParser stream
 * @param {String} [encoding] The encoding to be used when "chunk" is a string
 * @returns {Boolean} Returns true if nothing is buffered, for later draining returns false
 */
MailParser.prototype.write = function(chunk, encoding){
    if(typeof chunk == "string"){
        chunk = new Buffer(chunk, encoding);
    }
    
    if(chunk && chunk.length){
        this.remainder += chunk.toString("binary");
        // to slow things down cache the input and process a bit later,
        // emit "drain" when data is processed
        process.nextTick(this.process.bind(this));
        return false;
    }else{
        return true;
    }
};

/**
 * Terminates the MailParser stream 
 * 
 * If "chunk" is set, writes it to the Stream before terminating.
 * 
 * @param {Buffer|String} chunk The data to be written to the MailParser stream
 * @param {String} [encoding] The encoding to be used when "chunk" is a string
 */
MailParser.prototype.end = function(chunk, encoding){
    if(typeof chunk == "string"){
        chunk = new Buffer(chunk, encoding);
    }
    if(chunk){
        this.remainder += chunk.toString("binary");
    }

    process.nextTick(this.process.bind(this, true));
};

/**
 * Processes the data written to the MailParser stream
 * 
 * The data is split into lines and each line is processed individually. Last
 * line in the batch is preserved as a remainder since it is probably not a
 * complete line but just the beginning of it. The remainder is later prepended
 * to the next batch of data.
 * 
 * If "lastLine" is set to true, 
 * 
 * @param {Boolean} [finalPart=false] if set to true indicates that this is the last part of the stream
 */
 var c =0;
MailParser.prototype.process = function(finalPart){
    
    finalPart = !!finalPart;
    
    var lines = this.remainder.split(/\r?\n|\r/),
        line, i, len;
        
    if(!finalPart){
        this.remainder = lines.pop();
        // force line to 1MB chunks if needed 
        if(this.remainder.length>1048576){
            this.remainder = this.remainder.replace(/(.{1048576}(?!\r?\n|\r))/g,"$&\n");
        }
    }
    
    for(i=0, len=lines.length; i < len; i++){
        line = lines[i];
        
        //console.log("LINE " + (++c) + " ("+this.state+"): "+line);
        
        if(this.state == STATES.header){
            if(this.processStateHeader(line) === true){
                continue;
            }
        }
        
        if(this.state == STATES.body){
            
            if(this.processStateBody(line) === true){
                continue;
            }
            
        }
    }
    
    if(!finalPart){
        process.nextTick(this.emit.bind(this, "drain"));
    }else{
        this.state = STATES.finished;
        process.nextTick(this.processMimeTree.bind(this));
    }
};

/**
 * Processes a line while in header state
 * 
 * If header state ends and body starts, detect if the contents is an attachment
 * and create a stream for it if needed
 * 
 * @param {String} line The contents of a line to be processed
 * @returns {Boolean} If state changes to body retuns true
 */
MailParser.prototype.processStateHeader = function(line){
    var boundary, i, len, attachment, 
        lastPos = this.currentNode.headers.length - 1,
        textContent = false;
    
    // Check if the header endas and body starts
    if(!line.length){
        this.state = STATES.body;
        
        // if there's unprocessed header data, do it now
        if(lastPos >= 0){
            this.processHeaderLine(lastPos);
        }
        
        // this is a very simple e-mail, no content type set
        if(!this.currentNode.parentNode && !this.currentNode.meta.contentType){
            this.currentNode.meta.contentType = "text/plain";
        }
        
        textContent = ["text/plain", "text/html"].indexOf(this.currentNode.meta.contentType || "") >= 0;
        
        // detect if this is an attachment or a text node (some agents use inline dispositions for text)
        if(textContent && (!this.currentNode.meta.contentDisposition || this.currentNode.meta.contentDisposition == "inline")){
            this.currentNode.attachment = false;
        }else if((!textContent || ["attachment", "inline"].indexOf(this.currentNode.meta.contentDisposition)>=0) && 
          !this.currentNode.meta.mimeMultipart){
            this.currentNode.attachment = true;
        }
        
        // handle attachment start
        if(this.currentNode.attachment){
            
            this.currentNode.meta.length = 0;
            this.currentNode.checksum = crypto.createHash("md5");
            
            fileName = this.currentNode.meta.fileName || "attachment";
            this.currentNode.meta.generatedFileName = this.generateFileName(fileName);
            
            attachment = {
                fileName: fileName
            };
            
            if(this.options.streamAttachments){
                if(this.currentNode.meta.contentType){
                    attachment.contentType = this.currentNode.meta.contentType || null;
                }
                
                if(this.currentNode.meta.contentId){
                    attachment.contentId = this.currentNode.meta.contentId || "";
                }
                
                if(this.currentNode.meta.charset){
                    attachment.charset = this.currentNode.meta.charset || "utf-8";
                }
            
                if(this.currentNode.meta.transferEncoding == "base64"){
                    this.currentNode.stream = new Streams.Base64Stream();
                }else if(this.currentNode.meta.transferEncoding == "quoted-printable"){
                    this.currentNode.stream = new Streams.QPStream("binary");
                }else{
                    this.currentNode.stream = new Streams.BinaryStream();
                }
                attachment.stream = this.currentNode.stream;
                
                this.emit("attachment", attachment);
            }else{
                this.currentNode.content = undefined;
            }
        }
        
        return true;
    }
    
    // unfold header lines if needed
    if(line.match(/^\s+/) && lastPos>=0){
        this.currentNode.headers[lastPos] += " " + line.trim();
    }else{
        this.currentNode.headers.push(line.trim());
        if(lastPos>=0){
            // if a complete header line is received, process it
            this.processHeaderLine(lastPos);
        }
    }
    
    return false;
};

/**
 * Processes a line while in body state
 * 
 * @param {String} line The contents of a line to be processed
 * @returns {Boolean} If body ends return true
 */
MailParser.prototype.processStateBody = function(line){
    var i, len, node,
        nodeReady = false;
    
    // Handle multipart boundaries
    if(line.substr(0, 2) == "--"){
        for(i=0, len = this.multipartTree.length; i<len; i++){
            
            // check if a new element block starts
            if(line == "--" + this.multipartTree[i].boundary){
                
                if(this.currentNode.content || this.currentNode.stream){
                    this.finalizeContents();
                }
                
                node = this.createMimeNode(this.multipartTree[i].node);
                this.multipartTree[i].node.childNodes.push(node);
                this.currentNode = node;
                this.state = STATES.header;
                nodeReady = true;
                break;
            }else 
            // check if a multipart block ends
              if(line == "--" + this.multipartTree[i].boundary + "--"){
                
                if(this.currentNode.content || this.currentNode.stream){
                    this.finalizeContents();
                }
                
                if(this.multipartTree[i].node.parentNode){
                    this.currentNode = this.multipartTree[i].node.parentNode;
                }else{
                    this.currentNode = this.multipartTree[i].node;
                }
                this.state = STATES.body;
                nodeReady = true;
                break;
            }
        }
    }
    if(nodeReady){
        return true;
    }
    // handle text or attachment line
    if(["text/plain", "text/html"].indexOf(this.currentNode.meta.contentType || "")>=0 && 
      !this.currentNode.attachment){
        this.handleTextLine(line);
    }else if(this.currentNode.attachment){
        this.handleAttachmentLine(line);
    }
    
    return false;
};

/**
 * Processes a complete unfolded header line
 * 
 * Processes a line from current node headers array and replaces its value.
 * Input string is in the form of "X-Mailer: PHP" and its replacement would be
 * an object {key: "x-mailer", value: "PHP"}
 * 
 * Additionally node meta object will be filled also, for example with data from
 * To: From: Cc: etc fields.
 * 
 * @param {Number} pos Which header element (from an header lines array) should be processed
 */
MailParser.prototype.processHeaderLine = function(pos){
    var key, value, parts, line;
    
    pos = pos || 0;
    
    if(!(line = this.currentNode.headers[pos])){
        return;
    }
    
    parts = line.split(":");
    
    key = parts.shift().toLowerCase().trim();
    value = parts.join(":").trim();
    
    switch(key){
        case "content-type":
            value = this.parseContentType(value);
            break;
        case "mime-version":
            this.currentNode.useMIME = true;
            break;
        case "date":
            this.currentNode.meta.date = new Date(datetime.strtotime(value)*1000 || Date.now());
            break;
        case "to":
            this.currentNode.to = mimelib.parseAddresses(value);
            break;
        case "from":
            this.currentNode.from = mimelib.parseAddresses(value);
            break;
        case "cc":
            this.currentNode.cc = mimelib.parseAddresses(value);
            break;
        case "bcc":
            this.currentNode.bcc = mimelib.parseAddresses(value);
            break;
        case "x-priority":
        case "x-msmail-priority":
        case "importance":
            value = this.parsePriority(value);
            break;
        case "message-id":
            this.currentNode.meta.messageId = this.trimQuotes(value);
            break;
        case "references":
            this.currentNode.meta.messageReferences = this.trimQuotes(value);
            break;
        case "in-reply-to":
            this.currentNode.meta.inReplyTo = this.trimQuotes(value);
            break;
        case "thread-index":
            this.currentNode.meta.threadIndex = value;
            break;
        case "content-transfer-encoding":
            this.currentNode.meta.transferEncoding = value.toLowerCase();
            break;
        case "subject":
            this.currentNode.subject = this.encodeString(value);
            break;
        case "content-disposition":
            this.parseContentDisposition(value);
            break;
        case "content-id":
            this.currentNode.meta.contentId = this.trimQuotes(value);
            break;
    }
    
    this.currentNode.headers[pos] = {key: key, value: value};
};

/**
 * Creates an empty node element for the mime tree
 * 
 * Created element includes parentNode property and a childNodes array. This is
 * needed to later walk the whole mime tree
 * 
 * @param {Object} [parentNode] the parent object for the created node
 * @returns {Object} node element for the mime tree
 */
MailParser.prototype.createMimeNode = function(parentNode){
    var node = {
        parentNode: parentNode || this.currentNode || null,
        headers: [],
        meta: {},
        childNodes: []
    };
    
    return node;
};

/**
 * Splits a header value into key-value pairs
 * 
 * Splits on ";", the first value will be set as defaultValue property and will
 * not be handled, others will be split on "=" to key-value pairs
 * 
 * For example
 * 
 *     content-type: text/plain; charset=utf-8
 * 
 * Will become
 * 
 *     {
 *         defaultValue: "text/plain",
 *         charset: "utf-8"
 *     }
 * 
 * @param {String} value A string to be splitted into key-value pairs
 * @returns {Object} a key-value object, with defaultvalue property
 */
MailParser.prototype.parseHeaderLineWithParams = function(value){
    var key, parts, returnValue = {};
    
    parts = value.split(";");
    returnValue.defaultValue = parts.shift().toLowerCase();
    
    for(var i=0, len = parts.length; i<len; i++){
        value = parts[i].split("=");
        key = value.shift().trim();
        value = value.join("=").trim();
        
        // trim quotes
        value = this.trimQuotes(value);
        returnValue[key] = value;
    }
    
    return returnValue;
};

/**
 * Parses a Content-Type header field value
 * 
 * Fetches additional properties from the content type (charset etc.) and fills
 * current node meta object with this data
 * 
 * @param {String} value Content-Type string
 * @returns {Object} parsed contenttype object
 */
MailParser.prototype.parseContentType = function(value){
    value = this.parseHeaderLineWithParams(value);
    if(value){
        if(value.defaultValue){
            value.defaultValue = value.defaultValue.toLowerCase();
            this.currentNode.meta.contentType = value.defaultValue;
            if(value.defaultValue.substr(0,"multipart/".length)=="multipart/"){
                this.currentNode.meta.mimeMultipart = value.defaultValue.substr("multipart/".length);
            }
        }else{
            this.currentNode.meta.contentType = "application/octet-stream";
        }
        if(value.charset){
            value.charset = value.charset.toLowerCase();
            if(value.charset.substr(0,4)=="win-"){
                value.charset = "windows-"+value.charset.substr(4); 
            }else if(value.charset.match(/^utf\d/)){
                value.charset = "utf-"+value.charset.substr(3); 
            }else if(value.charset.match(/^(us\-)?ascii$/)){
                value.charset = "utf-8"; 
            }  
            this.currentNode.meta.charset = value.charset;
        }
        if(value.format){
            this.currentNode.meta.textFormat = value.format;
        }
        if(value.boundary){
            this.currentNode.meta.mimeBoundary = value.boundary;
        }
        if(value.name && !this.currentNode.meta.fileName){
            this.currentNode.meta.fileName = this.replaceMimeWords(value.name);
        }
        if(value.boundary){
            this.currentNode.meta.mimeBoundary = value.boundary;
            this.multipartTree.push({
                boundary: value.boundary,
                node: this.currentNode
            });
        }
    } 
    return value;
};

/**
 * Parses Content-Disposition header field value
 * 
 * Fetches filename to current node meta object
 * 
 * @param {String} value A Content-Disposition header field
 */
MailParser.prototype.parseContentDisposition = function(value){
    var returnValue = {};
    
    value = this.parseHeaderLineWithParams(value);
    
    if(value){
        if(value.defaultValue){
            this.currentNode.meta.contentDisposition = value.defaultValue.trim().toLowerCase();
        }
        if(value.filename){
            this.currentNode.meta.fileName = this.replaceMimeWords(value.filename);
        }
    }
};

/**
 * Parses the priority of the e-mail
 * 
 * @param {String} value The priority value
 * @returns {String} priority string low|normal|high
 */
MailParser.prototype.parsePriority = function(value){
    value = value.toLowerCase().trim();
    if(!isNaN(value)){
        value = Number(value) || 0;
        if(value == 3){
            return "normal";
        }else if(value > 3){
            return "low";
        }else{
            return "high";
        }
    }else{
        switch(value){
            case "non-urgent":
            case "low":
                return "low";
            case "urgent":
            case "hight":
                return "high";
        }
    }
    return "normal";
};

/**
 * Processes a line in text/html or text/plain node
 * 
 * Append the line to the content property
 * 
 * @param {String} line A line to be processed 
 */
MailParser.prototype.handleTextLine = function(line){
    
    if(["quoted-printable", "base64"].indexOf(this.currentNode.meta.transferEncoding)>=0){
        if(typeof this.currentNode.content != "string"){
            this.currentNode.content = line;
        }
        this.currentNode.content += "\n"+line;
    }else{
        if(this.currentNode.meta.textFormat != "flowed"){
            if(typeof this.currentNode.content != "string"){
                this.currentNode.content = this.encodeString(line);
            }else{
                this.currentNode.content += "\n" + this.encodeString(line);
            }
        }else{
            if(typeof this.currentNode.content != "string"){
                this.currentNode.content = this.encodeString(line);
            }else if(this.currentNode.content.match(/[ ]{1,}$/)){
                this.currentNode.content += this.encodeString(line);
            }else{
                this.currentNode.content += "\n"+this.encodeString(line);
            }
        }
    }  
};

/**
 * Processes a line in an attachment node
 * 
 * If a stream is set up for the attachment write the line to the
 * stream as a Buffer object, otherwise append it to the content property
 * 
 * @param {String} line A line to be processed 
 */
MailParser.prototype.handleAttachmentLine = function(line){
    if(!this.currentNode.attachment){
        return;
    }
    if(this.currentNode.stream){
        this.currentNode.stream.write(new Buffer(line, "binary"));
    }else if("content" in this.currentNode){
        if(typeof this.currentNode.content!="string"){
            this.currentNode.content = line;
        }else{
            this.currentNode.content += "\r\n" + line;
        }
    }
};

/**
 * Finalizes a node processing
 * 
 * If the node is a text/plain or text/html, convert it to UTF-8 encoded string
 * If it is an attachment, convert it to a Buffer or if an attachment stream is
 * set up, close the stream
 */
MailParser.prototype.finalizeContents = function(){
    var streamInfo;
    if(this.currentNode.content){
        
        if(!this.currentNode.attachment){
            if(this.currentNode.meta.transferEncoding == "quoted-printable"){
                this.currentNode.content = mimelib.decodeQuotedPrintable(this.currentNode.content, false, this.currentNode.meta.charset);
            }else if(this.currentNode.meta.transferEncoding == "base64"){
                this.currentNode.content = mimelib.decodeBase64(this.currentNode.content, false, this.currentNode.meta.charset);
            }
        }else{
            if(this.currentNode.meta.transferEncoding == "quoted-printable"){
                this.currentNode.content = mimelib.decodeQuotedPrintable(this.currentNode.content, false, "binary");
            }else if(this.currentNode.meta.transferEncoding == "base64"){
                this.currentNode.content = new Buffer(this.currentNode.content.replace(/[^\w\+\/=]/g,''), "base64");
            }else{
                this.currentNode.content = new Buffer(this.currentNode.content, "binary");
            }
            this.currentNode.checksum.update(this.currentNode.content);
            this.currentNode.meta.checksum = this.currentNode.checksum.digest("hex");
            this.currentNode.meta.length = this.currentNode.content.length;
        }
        
    }

    if(this.currentNode.stream){
        streamInfo = this.currentNode.stream.end() || {};
        if(streamInfo.checksum){
            this.currentNode.meta.checksum = streamInfo.checksum;
        }
        if(streamInfo.length){
            this.currentNode.meta.length = streamInfo.length;
        }
    }
};

/**
 * Processes the mime tree
 * 
 * Finds text parts and attachments from the tree. If there's several text/plain
 * or text/html parts, push the ones from the lower parts of the tree to the
 * alternatives array
 * 
 * Emits "end" when finished
 */
MailParser.prototype.processMimeTree = function(){
    var level = 0, htmlLevel, textLevel, html, text,
        returnValue = {}, i, len;
    
    this.mailData = {html:[], text:[], alternatives:[], attachments:[]};
    
    if(!this.mimeTree.meta.mimeMultipart){
        this.processMimeNode(this.mimeTree, 0);
    }else{
        this.walkMimeTree(this.mimeTree);
    }
    
    if(this.mailData.html.length){
        for(i=0, len=this.mailData.html.length; i<len; i++){
            if(!returnValue.html || this.mailData.html[i].level < htmlLevel){
                if(html){
                    if(!returnValue.alternatives){
                        returnValue.alternatives = [];
                    }
                    returnValue.alternatives.push({
                        contentType: "text/html",
                        content: html
                    });
                }
                htmlLevel = this.mailData.html[i].level;
                html = this.mailData.html[i].content;
            }
        }
    }
    
    if(this.mailData.text.length){
        for(i=0, len=this.mailData.text.length; i<len; i++){
            if(!returnValue.text || this.mailData.text[i].level < textLevel){
                if(text){
                    if(!returnValue.alternatives){
                        returnValue.alternatives = [];
                    }
                    returnValue.alternatives.push({
                        contentType: "text/plain",
                        content: text
                    });
                }
                textLevel = this.mailData.text[i].level;
                text = this.mailData.text[i].content;
            }
        }
    }
    
    returnValue.header = this.mimeTree.headers;
    
    if(this.mimeTree.subject){
        returnValue.subject = this.mimeTree.subject;        
    }
    
    if(this.mimeTree.from){
        returnValue.from = this.mimeTree.from;        
    }
    
    if(this.mimeTree.to){
        returnValue.to = this.mimeTree.to;        
    }
    
    if(this.mimeTree.cc){
        returnValue.cc = this.mimeTree.cc;        
    }
    
    if(this.mimeTree.bcc){
        returnValue.bcc = this.mimeTree.bcc;        
    }
    
    if(html){
        returnValue.html = html;
    }
    
    if(text){
        returnValue.text = text;
    }
    
    if(this.mailData.attachments.length){
        returnValue.attachments = [];
        for(i=0, len=this.mailData.attachments.length; i<len; i++){
            returnValue.attachments.push(this.mailData.attachments[i].content);
        }
    }

    process.nextTick(this.emit.bind(this, "end", returnValue));
};

/**
 * Walks the mime tree and runs processMimeNode on each node of the tree
 * 
 * @param {Object} node A mime tree node
 * @param {Number} [level=0] current depth
 */
MailParser.prototype.walkMimeTree = function(node, level){
    level = level || 1;

    for(var i=0, len = node.childNodes.length; i<len; i++){
        this.processMimeNode(node.childNodes[i], level);
        this.walkMimeTree(node.childNodes[i], level+1);
    }
};

/**
 * Processes of a node in the mime tree
 * 
 * Pushes the node into appropriate this.mailData array (text/html to this.mailData.html array etc)
 * 
 * @param {Object} node A mime tree node
 * @param {Number} [level=0] current depth
 */
MailParser.prototype.processMimeNode = function(node, level){
    level = level || 0;

    if(!node.attachment){
        switch(node.meta.contentType){
            case "text/html":
                this.mailData.html.push({content: node.content || "", level: level});
                break;
            case "text/plain":
                this.mailData.text.push({content: node.content || "", level: level});
                break;
        }
    }else{
        node.meta = node.meta || {};
        if(node.content){
            node.meta.content = node.content;
        }
        this.mailData.attachments.push({content: node.meta || {}, level: level});
    }  
};

/**
 * Converts a string from one charset to another
 * 
 * @param {Buffer|String} value A String to be converted
 * @param {String} fromCharset source charset
 * @param {String} [toCharset="UTF-8"] destination charset
 * @returns {Buffer} Converted string as a Buffer (or SlowBuffer)
 */
MailParser.prototype.convertString = function(value, fromCharset, toCharset){
    toCharset = (toCharset || "utf-8").toUpperCase();
    fromCharset = (fromCharset || "utf-8").toUpperCase();
    
    value = typeof value=="string"?new Buffer(value, "binary"):value;
    
    if(toCharset == fromCharset){
        return value;
    }
    
    try{ // in case there is no such charset or EINVAL occurs leave the string untouched
        if(!this.iconv[fromCharset+toCharset]){
            this.iconv[fromCharset+toCharset] = new Iconv(fromCharset, toCharset+'//TRANSLIT//IGNORE');
        }
        value = this.iconv[fromCharset+toCharset].convert(value);
    }catch(E){}
    
    return value;
};

/**
 * Encodes a header string to UTF-8
 * 
 * @param {String} value String to be encoded
 * @returns {String} UTF-8 encoded string
 */
MailParser.prototype.encodeString = function(value){
    value = this.replaceMimeWords(this.convertString(value, this.currentNode.meta.charset).toString("utf-8"));
    return value;
};

/**
 * Replaces mime words in a string with UTF-8 encoded strings
 * 
 * @param {String} value String to be converted
 * @returns {String} converted string
 */
MailParser.prototype.replaceMimeWords = function(value){
    return value.
        replace(/(=\?[^?]+\?[QqBb]\?[^?]+\?=)\s+(?==\?[^?]+\?[QqBb]\?[^?]+\?=)/g, "$1"). // join mimeWords
        replace(/\=\?[^?]+\?[QqBb]\?[^?]+\?=/g, (function(a){
            return mimelib.decodeMimeWord(a);
        }).bind(this));
};

/**
 * Removes enclosing quotes ("", '', <>) from a string
 * 
 * @param {String} value String to be converted
 * @returns {String} converted string
 */
MailParser.prototype.trimQuotes = function(value){
    value = (value || "").trim();
    if((value.charAt(0)=='"' && value.charAt(value.length-1)=='"') || 
      (value.charAt(0)=="'" && value.charAt(value.length-1)=="'") || 
      (value.charAt(0)=="<" && value.charAt(value.length-1)==">")){
        value = value.substr(1,value.length-2);
    }
    return value;
};

/**
 * Generates a context unique filename for an attachment
 * 
 * If a filename already exists, append a number to it
 * 
 *     file.txt
 *     file-1.txt
 *     file-2.txt
 * 
 * @param {String} fileName source filename
 * @returns {String} generated filename
 */
MailParser.prototype.generateFileName = function(fileName){
    var ext;
    
    // remove path if it is included in the filename
    fileName = (fileName || "attachment").toString().split(/[\/\\]+/).pop().replace(/^\.+/,"") || "attachment";
    
    if(fileName in this.fileNames){
        this.fileNames[fileName]++;
        ext = fileName.substr((fileName.lastIndexOf(".") || 0)+1);
        if(ext == fileName){
            fileName += "-" +  this.fileNames[fileName];
        }else{
            fileName = fileName.substr(0, fileName.length - ext.length - 1) + "-" + this.fileNames[fileName] + "." + ext;
        }
    }else{
        this.fileNames[fileName] = 0;
    }
    return fileName;  
};