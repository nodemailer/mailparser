var MailParser = require("../lib/mailparser").MailParser,
    mailparser = new MailParser({
        debug: true
    });

var email = "From: 'Sender Name' <sender@example.com>\r\n"+
            "To: 'Receiver Name' <receiver@example.com>\r\n"+
            "Subject: Hello world!\r\n"+
            "\r\n"+
            "How are you today?\r\n"+
            "Another line of text";

// setup an event listener when the parsing finishes
mailparser.on("end", function(mail_object){
    console.log("From:", mail_object.from); //[{address:'sender@example.com',name:'Sender Name'}]
    console.log("Subject:", mail_object.subject); // Hello world!
    console.log("Text body:", mail_object.text); // How are you today
});

// send the email source to the parser, char by char
for(var i=0, len=email.length; i<len; i++){
    mailparser.write(email.charAt(i));
}
mailparser.end();