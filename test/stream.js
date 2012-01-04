var MailParser = require("../lib/mailparser").MailParser,
    utillib = require("util"),
    fs = require("fs");


var inp = fs.createReadStream("large.eml"),
    out = new MailParser({
        streamAttachments: true
    });

inp.pipe(out);

out.on("end", function(structure){
    console.log("Mail structure:");
    console.log(utillib.inspect(structure, false, 9));
});

out.on("attachment", function(data){
    
    var length = 0;
    
    console.log("Attachment stream:");
    console.log(data);
    
    data.stream.on("data", function(chunk){
        length += chunk.length;
    });
    
    data.stream.on("end", function(chunk){
        console.log("Attachment stream ended for "+data.fileName+": transmitted "+length+" bytes");
    });
    
});