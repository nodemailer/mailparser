var MailParser = require("../lib/mailparser").MailParser,
    testCase = require('nodeunit').testCase,
    utillib = require("util");



exports["General"] = {
    "Many chunks": function(test){
        var encodedText = "Content-Type: text/plain; charset=utf-8\r\n\r\nÕÄ\r\nÖÜ", // \r\nÕÄÖÜ
            mail = new Buffer(encodedText, "utf-8");
        
        test.expect(1);
        var mailparser = new MailParser();
        
        for(var i=0, len = mail.length; i<len; i++){
            mailparser.write(new Buffer([mail[i]]));
        }
        
        mailparser.end();
        mailparser.on("end", function(mail){
            test.equal(mail.text, "ÕÄ\nÖÜ");
            test.done();
        });
    }
    
}

exports["Text encodings"] = {
    
    "Plaintext encoding: Default": function(test){
        var encodedText = [13,10, 213, 196, 214, 220], // \r\nÕÄÖÜ
            mail = new Buffer(encodedText);
        
        test.expect(1);
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "ÕÄÖÜ");
            test.done();
        });
    },
    
    "Plaintext encoding: Header defined": function(test){
        var encodedText = "Content-Type: TEXT/PLAIN; CHARSET=UTF-8\r\n\r\nÕÄÖÜ", // \r\nÕÄÖÜ
            mail = new Buffer(encodedText, "utf-8");
        
        test.expect(1);
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "ÕÄÖÜ");
            test.done();
        });
    },
    
    "HTML encoding: From <meta>": function(test){
        var encodedText = "Content-Type: text/html\r\n\r\n<html><head><meta charset=\"utf-8\"/></head><body>ÕÄÖÜ", // \r\nÕÄÖÜ
            mail = new Buffer(encodedText, "utf-8");
        
        test.expect(1);
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal((mail.html || "").substr(-4), "ÕÄÖÜ");
            test.done();
        });
    },
    
    "HTML encoding: Conflicting headers": function(test){
        var encodedText = "Content-Type: text/html; charset=iso-8859-1\r\n\r\n<html><head><meta charset=\"utf-8\"/></head><body>ÕÄÖÜ", // \r\nÕÄÖÜ
            mail = new Buffer(encodedText, "utf-8");
        
        test.expect(1);
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal((mail.html || "").substr(-4), "ÕÄÖÜ");
            test.done();
        });
    },
    "Mime Words": function(test){
        var encodedText = "Content-type: text/plain; charset=utf-8\r\nSubject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.subject, "Avaldus lepingu lõpetamiseks");
            test.done();
        }); 
    }
}

exports["Binary encodings"] = {
    "Quoted-Printable": function(test){
        var encodedText = "Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=00=01=02=03",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(Array.prototype.slice.apply(mail.attachments && mail.attachments[0] && mail.attachments[0].content && mail.attachments[0].content || []).join(","), "0,1,2,3");
            test.done();
        }); 
    },
    "Base64": function(test){
        var encodedText = "Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\nAAECAw==",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(Array.prototype.slice.apply(mail.attachments && mail.attachments[0] && mail.attachments[0].content && mail.attachments[0].content || []).join(","), "0,1,2,3");
            test.done();
        }); 
    },
    "8bit": function(test){
        var encodedText = "Content-Type: application/octet-stream\r\n\r\nÕÄÖÜ",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(Array.prototype.slice.apply(mail.attachments && mail.attachments[0] && mail.attachments[0].content && mail.attachments[0].content || []).join(","), "195,149,195,132,195,150,195,156");
            test.done();
        }); 
    }
    
}

exports["Plaintext format"] = {
    "Default": function(test){
        var encodedText = "Content-Type: text/plain;\r\n\r\nFirst line \r\ncontinued",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "First line \ncontinued");
            test.done();
        }); 
    },
    "Flowed": function(test){
        var encodedText = "Content-Type: text/plain; format=flowed\r\n\r\nFirst line \r\ncontinued",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "First line continued");
            test.done();
        }); 
    },
    "Fixed": function(test){
        var encodedText = "Content-Type: text/plain; format=fixed\r\n\r\nFirst line \r\ncontinued",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "First line \ncontinued");
            test.done();
        }); 
    }
}

exports["Transfer encoding"] = {
    "Quoted-Printable": function(test){
        var encodedText = "Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=C3=95=C3=84=C3=96=C3=9C",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "ÕÄÖÜ");
            test.done();
        }); 
    },
    "Base64": function(test){
        var encodedText = "Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: bAse64\r\n\r\nw5XDhMOWw5w=",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "ÕÄÖÜ");
            test.done();
        }); 
    },
    "Mime Words": function(test){
        var encodedText = "Content-type: text/plain; charset=utf-8\r\nSubject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.subject, "Avaldus lepingu lõpetamiseks");
            test.done();
        }); 
    },
    "8bit": function(test){
        var encodedText = "Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nÕÄÖÜ",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "ÕÄÖÜ");
            test.done();
        }); 
    }
    
}

exports["Multipart"] = {
    "Simple": function(test){
        var encodedText = "Content-type: multipart/mixed; boundary=ABC\r\n\r\n--ABC\r\nContent-type: text/plain; charset=utf-8\r\n\r\nÕÄÖÜ\r\n--ABC--",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "ÕÄÖÜ");
            test.done();
        });
    },
    "Nested": function(test){
        var encodedText = "Content-type: multipart/mixed; boundary=ABC\r\n"+
                          "\r\n"+
                          "--ABC\r\n"+
                          "Content-type: multipart/related; boundary=DEF\r\n"+
                          "\r\n"+
                          "--DEF\r\n"+
                          "Content-type: text/plain; charset=utf-8\r\n"+
                          "\r\n"+
                          "ÕÄÖÜ\r\n"+
                          "--DEF--\r\n"+
                          "--ABC--",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "ÕÄÖÜ");
            test.done();
        });
    },
    "Inline text (Sparrow)": function(test){
        var encodedText = "Content-type: multipart/mixed; boundary=ABC\r\n"+
                          "\r\n"+
                          "--ABC\r\n"+
                          "Content-Type: text/plain; charset=\"utf-8\"\r\n"+
                          "Content-Transfer-Encoding: 8bit\r\n"+
                          "Content-Disposition: inline\r\n"+
                          "\r\n"+
                          "ÕÄÖÜ\r\n"+
                          "--ABC--",
            mail = new Buffer(encodedText, "utf-8");
        
        var mailparser = new MailParser();
        mailparser.end(mail);
        mailparser.on("end", function(mail){
            test.equal(mail.text, "ÕÄÖÜ");
            test.done();
        });
    }
}