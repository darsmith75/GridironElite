// Simple test file for iisnode
console.log('Test file loaded');

module.exports = function(req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end('<html><body><h1>iisnode is working!</h1><p>Node.js version: ' + process.version + '</p><p>Time: ' + new Date() + '</p></body></html>');
};
