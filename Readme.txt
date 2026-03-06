To run this website on a different server, you'll need these essential files and folders:

Core Application Files:

server.js - Main Node.js server
database.js - Database initialization
package.json - Dependencies list
package-lock.json - Locked dependency versions
Public Frontend Files (public/ folder):

index.html - Login page
app.js - Shared JavaScript functions
styles.css - All styling
agent-dashboard.html - Agent's main page
agent-profile.html - Agent profile page
player-profile.html - Player profile page
player-detail.html - Player detail view
player-card.html - Player card view
messages.html - Messaging interface
Asset Folders:

images/ - Company logo and background images
logos/ - Social media logos (Hudl, Instagram, X)
uploads/ - User-uploaded files (or create empty folder)
Database:

football_platform.db - SQLite database (or run seed-data.js to create new one)
Optional Setup Files:

seed-data.js - To populate initial data
README.md - Documentation
Steps to deploy:

Copy all files above to new server
Install Node.js on the server
Run npm install to install dependencies
Set environment variable PORT if needed (defaults to 3000)
Run node server.js to start
The website has 5,644 lines of code total across all main files.