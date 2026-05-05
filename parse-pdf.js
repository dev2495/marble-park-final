const pdf = require('pdf-parse/lib/pdf-parse.js');

pdf(dataBuffer).then(function(data) {
    console.log("NUMPAGES:", data.numpages);
    console.log("TEXT:");
    console.log(data.text);
}).catch(console.error);
