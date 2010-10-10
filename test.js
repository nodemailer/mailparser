var mailparser = require("./mailparser"),
    fs = require("fs"),
    sys = require("sys");

fs.readFile('mail.txt', function (err, data) {
    if (err) throw err;
    
    var mp = new mailparser.MailParser();
    
    // callback for the headers object
    mp.on("headers", function(headers){
        console.log("HEADERS");
        console.log(sys.inspect(headers, false, 5));
    });

    // callback for the body object
    mp.on("body", function(body){
        console.log("BODY");
        console.log(sys.inspect(body, false, 7));
    });
    
    // callback for an attachment stream start with attachment headers
    mp.on("astart", function(id, headers){
        console.log("ATTACHMENT HEADERS FOR "+id);
        console.log(sys.inspect(headers, false, 5));
    });
    
    // callback for an attachment stream (every attachment gets an unique ID)
    mp.on("astream", function(id, buffer){
        console.log("ATTACHMENT STREAM FOR "+id);
        console.log(buffer.length+" bytes");
    });
    
    // callback to say that an attachment has bee parsed
    mp.on("aend", function(id){
        console.log("ATTACHMENT STREAM FOR "+id+" ENDED");
    });
    
    // split data into multiple parts
    data = data.toString("ascii");
    var parts = 3, l=Math.floor(data.length/parts);
    for(var i=0; i<parts; i++){
        if(i<parts-1){
            // feed the parser with data
            mp.feed(data.substr(i*l, l));
        }else
            mp.feed(data.substr(i*l)); // last part to the end
    }
    
    // all data sent to the parser, wait for callbacks
    mp.end();
});