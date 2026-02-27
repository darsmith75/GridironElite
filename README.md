# High School Football Agent Platform

A web application that connects high school football players with sports agents. Players can create detailed profiles showcasing their athletic metrics, academic achievements, and highlight videos, while agents can search and filter through player profiles to find talent.

## Features

### For Players
- Create and manage detailed athletic profiles
- Upload profile pictures, highlight videos, and additional images
- Track physical metrics (40-yard dash, vertical jump, bench press, etc.)
- Display academic information (GPA, graduation year, school)
- Showcase college offers with university logos
- Add personal bio and contact information

### For Agents
- Search and filter players by multiple criteria:
  - Position
  - Graduation year
  - GPA
  - Physical metrics (speed, strength, agility)
  - Height and weight
- View compact player cards in a responsive grid
- Access detailed player profiles with full statistics
- Real-time data updates

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: SQLite (better-sqlite3-multiple-ciphers)
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **File Upload**: Multer
- **Authentication**: bcrypt

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd <repo-name>
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
node server.js
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

## Default Credentials

### Agent Account
- Email: `agent@example.com`
- Password: `agent123`

### Sample Player Accounts
The database includes 5 sample players with realistic data. You can also register new player accounts.

## Database Schema

The application uses SQLite with two main tables:

- **users**: Authentication and role management
- **player_profiles**: Comprehensive player information including metrics, media, and academic data

## Project Structure

```
├── public/
│   ├── index.html           # Login/registration page
│   ├── player-profile.html  # Player profile editor
│   ├── player-detail.html   # Detailed player view
│   ├── agent-dashboard.html # Agent search interface
│   ├── app.js              # Frontend JavaScript
│   └── styles.css          # Application styles
├── uploads/                # User-uploaded media
├── images/                 # Sample images
├── server.js              # Express server
├── database.js            # Database configuration
├── seed-data.js           # Sample data generator
└── package.json           # Dependencies

```

## API Endpoints

### Authentication
- `POST /api/register` - Register new user
- `POST /api/login` - User login

### Player Profile
- `GET /api/player/profile` - Get player profile
- `POST /api/player/profile` - Update player profile
- `POST /api/player/upload` - Upload media files
- `DELETE /api/player/video/:filename` - Delete video
- `DELETE /api/player/image/:filename` - Delete image
- `DELETE /api/player/offer/:filename` - Delete college offer logo

### Agent
- `GET /api/agent/players` - Search/filter players
- `GET /api/agent/player/:id` - Get specific player details

## Features in Detail

### Physical Metrics Tracked
- Height & Weight
- 40-Yard Dash
- Vertical Jump
- Bench Press
- Squat
- 5-10-5 Shuttle
- L-Drill
- Broad Jump
- Power Clean
- Single Leg Squat

### Media Management
- Profile picture (1 per player)
- Highlight videos (up to 5)
- Additional images (up to 10)
- College offer logos (up to 20)

## Development

To add sample data:
```bash
node seed-data.js
```

To add sample metrics to existing players:
```bash
node add-sample-metrics.js
```

## License

MIT

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.
