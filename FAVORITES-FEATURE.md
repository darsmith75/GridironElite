# Agent Favorites Feature

## Overview
Agents can now mark players as favorites and filter the dashboard to show only their favorite players.

## Features Implemented

### 1. Database
- Created `agent_favorites` table with columns:
  - `id` (PRIMARY KEY)
  - `agent_id` (FOREIGN KEY to users)
  - `player_id` (FOREIGN KEY to users)
  - `created_at` (DATETIME)
  - UNIQUE constraint on (agent_id, player_id) to prevent duplicates

### 2. API Endpoints (server.js)
- `POST /api/agent/favorites/:playerId` - Add player to favorites
- `DELETE /api/agent/favorites/:playerId` - Remove player from favorites
- `GET /api/agent/favorites` - Get all favorite player IDs for current agent
- `GET /api/agent/favorites/:playerId` - Check if specific player is favorited
- Updated `GET /api/agent/players` to support `favoritesOnly=true` query parameter

### 3. Agent Dashboard (agent-dashboard.html)
- Added "⭐ Favorites Only" toggle checkbox next to the search bar
- Added favorite star button (☆/⭐) to each player card in the top-right corner
- Star is empty (☆) for non-favorites, filled (⭐) with gold gradient for favorites
- Clicking star toggles favorite status without page reload
- When "Favorites Only" is checked, only favorited players are shown
- Favorites persist across sessions and are agent-specific

### 4. Player Detail Page (player-detail.html)
- Added "Add to Favorites" / "Remove from Favorites" button at the top
- Button shows current favorite status with star icon (☆/⭐)
- Button has gold gradient background when player is favorited
- Clicking button toggles favorite status

### 5. Styling (styles.css)
- `.favorite-star` - Floating star button on player cards
  - White background with shadow
  - Gold gradient when favorited
  - Hover effect with scale animation
- `.favorites-toggle` - Toggle checkbox styling
  - Light gray background
  - Hover effect
  - Compact design
- `.favorite-detail-btn` - Favorite button on detail page
  - Matches other action buttons
  - Gold gradient when favorited
  - Smooth transitions

## How It Works

### For Agents:
1. Browse players on the dashboard
2. Click the star (☆) on any player card to add to favorites
3. Star turns gold (⭐) to indicate favorited status
4. Check "⭐ Favorites Only" to filter dashboard to show only favorites
5. Click star again to remove from favorites
6. On player detail page, use "Add to Favorites" button for same functionality

### Technical Details:
- Favorites are stored per agent (each agent has their own favorites list)
- Uses AJAX calls to update favorites without page reload
- Dashboard automatically reloads when removing a favorite while "Favorites Only" is active
- Favorite status is checked on page load for detail page
- All favorite operations require authentication

## Files Modified:
1. `database.js` - Added agent_favorites table
2. `server.js` - Added 4 new API endpoints + updated players endpoint
3. `public/agent-dashboard.html` - Added toggle and star buttons
4. `public/player-detail.html` - Added favorite button
5. `public/styles.css` - Added styling for favorite elements

## Testing:
- Run `node test-favorites.js` to verify table creation
- Log in as agent (agent@example.com or agent2@example.com)
- Click stars on player cards to add/remove favorites
- Toggle "Favorites Only" to filter view
- Verify favorites persist after logout/login
- Verify each agent has separate favorites list
