const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name: 'Football Agent Platform',
  description: 'High School Football Agent Platform Web Server',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ],
  env: {
    name: "NODE_ENV",
    value: "production"
  }
});

// Listen for the "install" event
svc.on('install', function(){
  console.log('Service installed successfully!');
  svc.start();
});

// Install the service
svc.install();
