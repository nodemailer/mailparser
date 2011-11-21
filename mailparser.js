var EventEmitter = require('events').EventEmitter,
    sys = require('sys'),
    mime = require("./mime"),
    datetime = require("./datetime");

var PARSE_HEADERS = 1,
    PARSE_BODY = 2;

MailParser = function(){
    EventEmitter.call(this);
    if (arguments.length === 1) {
        // new MailParser(options)
        var options = arguments[0];
        this.mailFrom = options.mail_from;
        this.rcptTo   = options.rcpt_to;
        this.fix_smtp_escapes = options.hasOwnProperty('fix_smtp_escapes') ? options.fix_smtp_escapes : 1;
    }
    else {
        // new MailParser(mailFrom, rcptTo)
        this.mailFrom = arguments[0];
        this.rcptTo = arguments[1];
    }

    this.headerStr = "";

    this.waitFor = 0;
    this.receivedAll = false;

    this.headers = {};
    this.bodyData = {bodyText:"", bodyHTML:"", bodyAlternate:[], attachments:[]};

    this.state = PARSE_HEADERS;
}
sys.inherits(MailParser, EventEmitter);

exports.MailParser = MailParser;

MailParser.prototype.feed = function(data){
    if (this.fix_smtp_escapes)
        data = data.replace(/\r\n\.\./g,"\r\n.");
    if(this.state == PARSE_HEADERS){
        data = this.parseHeaders(data);
    }else if(this.state == PARSE_BODY){
        data = this.parseBody(data);
    }
}

MailParser.prototype.end = function(){
    if(this.headers.multipart && (this.waitFor || !this.receivedAll))
        return;

    if(this.state == PARSE_BODY){
        this.parseBodyEnd();
    }

    this.emit("end");
}

MailParser.prototype.parseHeaders = function(data){
    var match;
    this.headerStr += data;
    if(match=this.headerStr.match(/^([\s\S]*?\r\n)[ \t]*\r\n/)){
        var remainder = this.headerStr.slice(match[0].length);
        this.headerStr = match[1];
        this.headerObj = mime.parseHeaders(this.headerStr);
        this.analyzeHeaders(this.headerObj, this.headers);
        delete this.headerObj; // not needed anymore
        delete this.headerStr; // just ditch it
        this.emit("headers", this.headers);
        this.state = PARSE_BODY;
        this.parseBodyStart(remainder);
    }
    return data; // this makes no sense as far as I can tell, but leaving it in.
}

MailParser.prototype.analyzeHeaders = function(headerObj, headers){
    var parts, headersUsed = [];

    // mime version
    headersUsed.push("mime-version");
    headers.useMime = !!parseFloat(headerObj["mime-version"] && headerObj["mime-version"][0]);

    // content type
    headersUsed.push("content-type");
    parts = {};
    if(headerObj["content-type"]){
        parts = mime.parseHeaderLine(headerObj["content-type"] && headerObj["content-type"][0]);
    }
    headers.contentType = parts.defaultValue && parts.defaultValue.toLowerCase() || "text/plain";

    // charset
    headers.charset = parts.charset || "us-ascii";
    // Some mails incorrectly quote the charset. Let's deal with that.
    headers.charset = headers.charset.replace(/"/g, '');

    // format=fixed|flowed (RFC2646)
    headers.format = parts.format && parts.format.toLowerCase() || "fixed";

    // filename
    headers.filename = parts.name && mime.parseMimeWords(parts.name.replace(/^[\s"']+|[\s"']+$/g,"")).trim() || false;

    // mime-boundary
    headers.multipart = false;
    headers.mimeBoundary = false;
    if(headers.contentType.substr(0,"multipart/".length)=="multipart/"){
        headers.mimeBoundary = parts.boundary.replace(/^[\s"']+|[\s"']+$/g,"").trim();
        headers.multipart = true;
    }

    // message ID
    headersUsed.push("message-id");
    parts = {};
    if(headerObj["message-id"] && headerObj["message-id"][0]){
        headers.messageId = headerObj["message-id"][0].replace(/^</, '').replace(/>*$/, '');
    } else {
        headers.messageId = "";
    }

    // content ID
    headersUsed.push("content-id");
    parts = {};
    if(headerObj["content-id"]){
        parts = mime.parseHeaderLine(headerObj["content-id"] && headerObj["content-id"][0]);
    }
    headers.contentId = (parts.defaultValue || "").replace(/^</, '').replace(/>*$/, '');

    // date
    headersUsed.push("date");
    parts = {};
    if(headerObj["date"]){
        parts = mime.parseHeaderLine(headerObj["date"] && headerObj["date"][0]);
    }
    headers.messageDate = parts.defaultValue && datetime.strtotime(parts.defaultValue)*1000 || Date.now();

    headers.receivedDate = Date.now();

    // content-transfer-encoding
    headersUsed.push("content-transfer-encoding");
    parts = {};
    if(headerObj["content-transfer-encoding"]){
        parts = mime.parseHeaderLine(headerObj["content-transfer-encoding"] && headerObj["content-transfer-encoding"][0]);
    }
    headers.contentTransferEncoding = parts.defaultValue || "7bit";

    // from
    headersUsed.push("from");
    headers.addressesFrom = [];
    if(headerObj["from"]){
        for(var i=0, len = headerObj["from"].length;i<len; i++){
            headers.addressesFrom = headers.addressesFrom.concat(mime.parseAddresses(headerObj["from"][i]));
        }
    }

    // reply-to
    headersUsed.push("reply-to");
    headers.addressesReplyTo = [];
    if(headerObj["reply-to"]){
        for(var i=0, len = headerObj["reply-to"].length;i<len; i++){
            headers.addressesReplyTo = headers.addressesReplyTo.concat(mime.parseAddresses(headerObj["reply-to"][i]));
        }
    }

    // to
    headersUsed.push("to");
    headers.addressesTo = [];
    if(headerObj["to"]){
        for(var i=0, len = headerObj["to"].length;i<len; i++){
            headers.addressesTo = headers.addressesTo.concat(mime.parseAddresses(headerObj["to"][i]));
        }
    }

    // cc
    headersUsed.push("cc");
    headers.addressesCc = [];
    if(headerObj["cc"]){
        for(var i=0, len = headerObj["cc"].length;i<len; i++){
            headers.addressesCc = headers.addressesCc.concat(mime.parseAddresses(headerObj["cc"][i]));
        }
    }

    // subject
    headersUsed.push("subject");
    if(headers.useMime){
        headers.subject = mime.parseMimeWords(headerObj["subject"] && headerObj["subject"][0] || "");
    }else
        headers.subject = headerObj["subject"] && headerObj["subject"][0] || "";

    // priority
    headersUsed.push("x-priority");
    headersUsed.push("priority");
    headersUsed.push("importance");
    headersUsed.push("x-msmail-priority");

    headers.priority = 3;
    if(headerObj["x-priority"]){
        var nr = headerObj["x-priority"][0].match(/\d/);
        nr = parseInt(nr && nr[0]);
        if(nr>3)
            headers.priority = 5;
        if(nr<3)
            headers.priority = 1;
    }else if(headerObj["x-priority"] || headerObj["x-msmail-priority"]){
        switch((headerObj["x-priority"] || headerObj["x-msmail-priority"])[0].toLowerCase().trim()){
            case "low":
                headers.priority = 5;
                break;
            case "normal":
                headers.priority = 3;
                break;
            case "hight":
                headers.priority = 1;
                break;
        }
    }else if(headerObj["importance"]){
        switch(headerObj["importance"][0].toLowerCase().trim()){
            case "non-urgent":
                headers.priority = 5;
                break;
            case "normal":
                headers.priority = 3;
                break;
            case "urgent":
                headers.priority = 1;
                break;
        }
    }



    // content-disposition
    headersUsed.push("content-disposition");
    parts = {};
    if(headerObj["content-disposition"]){
        parts = mime.parseHeaderLine(headerObj["content-disposition"] && headerObj["content-disposition"][0]);
    }
    headers.contentDisposition = parts.defaultValue || false;

    if(!headers.filename && parts.filename)
        headers.filename = mime.parseMimeWords(parts.filename.replace(/^[\s"']+|[\s"']+$/g,"")).trim();

    headers.secondary = [];
    var keys = Object.keys(headerObj);
    for(var i=0, len=keys.length; i<len; i++){
        if(headersUsed.indexOf(keys[i])<0){
            var row = {};
            row.name = keys[i];
            row.value = headerObj[keys[i]];
            headers.secondary.push(row);
        }
    }
}

MailParser.prototype.parseBodyStart = function(data){
    this.body = {
        mimeContents: false,
        headersComplete: false,
        headerStr: "",
        headerObj: {},
        headers: {},
        ds: null
    }
    this.parseBody(data);
}

MailParser.prototype.parseBody = function(data){

    if(this.headers.multipart){
        var pos = pos2 = 0, parts, pos3;
        do{
            pos3=false;
            if(this.body.mimeContents){

                // handle headers
                if(!this.body.headerStrComplete){
                    if((pos2 = data.indexOf("\r\n\r\n", pos))>=0){
                        this.body.headerStr += data.substring(pos, pos2);
                        pos = pos2+4;
                        this.body.headerStrComplete = true;
                        this.body.headerObj = mime.parseHeaders(this.body.headerStr.trim());

                        this.body.headers = {};
                        this.analyzeHeaders(this.body.headerObj, this.body.headers);

                        this.waitFor++;

                        // TEXT
                        if(this.body.headers.contentType.substr(0,"text/".length)=="text/"){
                            this.body.ds = new DataStore("text", this.body.headers);
                            this.setUpDSCallback(this.body.headers);
                        }

                        // MULTIPART
                        else if(this.body.headers.contentType.substr(0,"multipart/".length)=="multipart/"){
                            this.body.ds = new MailParser();
                            this.setUpMPCallback(this.body.headers);
                            this.body.ds.feed(this.body.headerStr.trim()+"\r\n\r\n");
                        }

                        // BINARY
                        else{
                            this.body.ds = new DataStore("binary", this.body.headers);
                            this.setUpDSCallback(this.body.headers);
                        }


                        this.body.headerStr = "";
                    }else{
                        this.body.headerStr += data.substr(pos);
                        break;
                    }
                }

                if(this.body.ds){
                    pos3 = data.indexOf("--"+this.headers.mimeBoundary, pos);
                    this.body.ds.feed(pos3>=0?data.substring(pos,pos3):data.substr(pos));
                    if(pos3>=0){
                        this.body.ds.end();
                        this.body.ds = null;
                    }
                }

            }

            pos = pos3!==false?pos3:data.indexOf("--"+this.headers.mimeBoundary, pos);
            if(pos>=0){
                pos += ("--"+this.headers.mimeBoundary).length;
                this.body.headerStrComplete = false;
                this.body.headerStr = "";
                this.body.mimeContents = true;
                if(data.substr(pos,2)=="--"){
                    // last boundary
                    this.receivedAll = true;
                    return;
                }
            }
        }while(pos>=0);
    }else{
        this.bodyData.bodyText += data;
    }
}

MailParser.prototype.setUpDSCallback = function(headers){

    this.body.ds.on("astart", (function(id, data){
        this.emit("astart",id, data);
    }).bind(this));

    this.body.ds.on("astream", (function(id, data){
        this.emit("astream",id, data);
    }).bind(this));

    this.body.ds.on("end", (function(data){
        var done = false;
        if(!headers.contentDisposition){
            // body
            switch(headers.contentType){
                case "text/plain":
                    if(!this.bodyData.bodyText){
                        this.bodyData.bodyText = data && data.body;
                        done = true;
                    }
                    break;
                case "text/html":
                    if(!this.bodyData.bodyHTML){
                        this.bodyData.bodyHTML = data && data.body;
                        done = true;
                    }
                    break;
            }
            if(!done)
                this.bodyData.bodyAlternate.push({
                    contentType: headers.contentType,
                    data: data
                });
        }else{
            // attachments
            this.bodyData.attachments.push({
                contentType: headers.contentType,
                contentDisposition: headers.contentDisposition,
                contentId: headers.contentId,
                filename: headers.filename,
                data: data
            });
            this.emit("aend",data.id);
        }

        if(!(--this.waitFor)){
            this.end();
        }
    }).bind(this));
}


MailParser.prototype.setUpMPCallback = function(headers){

    this.body.ds.on("astart", (function(id, data){
        this.emit("astart",id, data);
    }).bind(this));

    this.body.ds.on("astream", (function(id, data){
        this.emit("astream",id, data);
    }).bind(this));

    this.body.ds.on("aend", (function(id){
        this.emit("aend",id);
    }).bind(this));

    this.body.ds.on("headers", (function(data){}).bind(this));
    this.body.ds.on("body", (function(data){

        this.bodyData.bodyAlternate.push({
            contentType: headers.contentType,
            body: data
        });

        if(!(--this.waitFor)){
            this.end();
        }
    }).bind(this));
}

MailParser.prototype.parseBodyEnd = function(){

    if(!this.headers.multipart && this.bodyData.bodyText){
        switch(this.headers.contentTransferEncoding.toLowerCase()){
            case "quoted-printable":
                this.bodyData.bodyText = mime.decodeQuotedPrintable(this.bodyData.bodyText, false, this.headers.charset);
                break;
            case "base64":
                this.bodyData.bodyText = mime.decodeBase64(this.bodyData.bodyText, false, this.headers.charset);
                break;
        }
        this.bodyData.bodyText = this.bodyData.bodyText.trim();
        if(this.headers.contentType=="text/html"){
            this.bodyData.bodyHTML = this.bodyData.bodyText;
            this.bodyData.bodyText = false;
        }
    }

    if(!this.bodyData.bodyText && !!this.bodyData.bodyHTML)
        this.bodyData.bodyText = stripHTML(this.bodyData.bodyHTML);

    this.emit("body",this.bodyData);
    return false;
}



// DataStore - load text into memory, put binary to Mongo GridStore
// return a) text - fulltext, b) binary - key
function DataStore(type, headers){
    EventEmitter.call(this);
    this.type = type || "text";
    this.encoding = headers && headers.contentTransferEncoding || "7bit";
    this.charset = headers && headers.charset.replace(/"/g, '') || "us-ascii";
    this.data = "";

    this.id = generateAttachmentId();

    this.stream = false;
    if(this.type=="binary"){
        this.data = 0;
        // FIX: assumes that binary is always base64!
        this.stream = new Base64Stream();
        this.stream.on("stream", this.onStream.bind(this));
        this.stream.on("end", this.onStreamEnd.bind(this));
    }

    this.started = false;
    this.headers = {
        contentType: headers.contentType,
        contentDisposition: headers.contentDisposition,
        contentId: headers.contentId,
        filename: headers.filename
    }
}
sys.inherits(DataStore, EventEmitter);

DataStore.prototype.feed = function(data){
    if(!this.started && this.type=="binary"){
        this.emit("astart", this.id, this.headers);
        this.started++;
    }
    if(this.type=="text")this.feedText(data);
    if(this.type=="binary")this.feedBinary(data);
}

DataStore.prototype.feedText = function(data){
    this.data += data;
}

DataStore.prototype.feedBinary = function(data){
    this.stream.feed(data);
}

DataStore.prototype.onStream = function(buffer){
    this.emit("astream", this.id, buffer)
}

DataStore.prototype.onStreamEnd = function(){
    this.emit("end", {id:this.id, body:null});
}

DataStore.prototype.end = function(){
    if(this.type=="text"){
        if(this.encoding && (this.encoding.toLowerCase() == "quoted-printable"))
            this.data = mime.decodeQuotedPrintable(this.data, false, this.charset).trim();
        if(this.encoding && (this.encoding.toLowerCase() == "base64"))
            this.data = mime.decodeBase64(this.data, this.charset).trim();

        this.emit("end", {id:this.id, body:this.data});

    }else{
        this.stream.end();
    }
}


// base64 stream decoder
function Base64Stream(){
    EventEmitter.call(this);
    this.current = "";
}
sys.inherits(Base64Stream, EventEmitter);

Base64Stream.prototype.feed = function(data){
    var remainder = 0;
    this.current += data.replace(/[^\w+\/=]/g,'');
    this.emit("stream", new Buffer(this.current.substr(0, this.current.length - this.current.length % 4),"base64"));
    this.current = (remainder=this.current.length % 4)?this.current.substr(- remainder):"";
}

Base64Stream.prototype.end = function(){
    if(this.current.length)
        this.emit("stream", new Buffer(this.current,"base64"));
    this.emit("end");
}


var attachment_id_counter = 0;
function generateAttachmentId(){
    return Date.now()+"-"+(++attachment_id_counter);
}

function stripHTML(str){
    if(!str)return str;

    str = str instanceof Buffer ? str.toString("utf-8"):str;

    str = str.replace(/\r?\n/g," ");
    str = str.replace(/<(?:\/p|br|\/tr|\/table|\/div)>/g,"\n");

    // hide newlines with two 00 chars (enables multiline matches)
    str = str.replace(/\r?\n/g,"-\u0000\u0000-");

    // H1-H6, add underline
    str = str.replace(/<[hH]\d[^>]*>(.*?)<\/[hH]\d[^>]*>/g,function(a,b){
        var line = "";
        b = b.replace(/<[^>]*>/g," ");
        b = b.replace(/\s\s+/g," ");
        b = b.trim();

        if(!b)
            return "";
        for(var i=0, len = b.length; i<len; i++){
            line+="-";
        }
        return b+"\n"+line+"\n\n";
    });

    // LI, indent by 2 spaces + *
    str = str.replace(/<li[^>]*>(.*?)<\/?(?:li|ol|ul)[^>]*>/ig,function(a,b){
        b = b.replace(/<[^>]*>/g," ");
        b = b.replace(/\s\s+/g," ");
        b = b.trim();

        if(!b)
            return "";
        return "-®®®®-* "+b+"\n";
    });

    // PRE, indent by 4 spaces
    str = str.replace(/<pre[^>]*>(.*?)<\/pre[^>]*>/ig,function(a,b){
        b = b.replace(/<[^>]*>/g," ");
        b = b.replace(/\s\s+/g," ");
        b = b.trim();

        if(!b)
            return "";

        b = b.replace(/[ \t]*\n[ \t]*/g,"\n-®®®®--®®®®-");

        return "\n-®®®®--®®®®-"+b.trim()+"\n\n";
    });

    // restore
    str = str.replace(/\s*-\u0000\u0000-\s*/g,"\n");

    // remove all remaining html tags
    str = str.replace(/<[^>]*>/g," ");
    // remove duplicate spaces
    str = str.replace(/[ ][ ]+/g," ");
    // remove spaces before and after newlines
    str = str.replace(/[ \t]*\n[ \t]*/g,"\n");
    // remove more than 2 newlines in a row
    str = str.replace(/\n\n+/g,"\n\n");
    // restore hidden spaces (four (r) signs for two spaces)
    str = str.replace(/-®®®®-/g,"  ");
    return str.trim();
}

