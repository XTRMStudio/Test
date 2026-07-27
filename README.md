# BlockWorld TDM

GitHub Pages-ready multiplayer voxel team-deathmatch prototype.

## Features
- Blue versus Red teams
- First team to 150 points wins
- Five-minute match timer
- Pixel gun, health, ammo, damage, eliminations and respawning
- Smooth drag camera controls on mobile
- Combat and Build modes
- Shared multiplayer block edits using PeerJS/WebRTC

## Publish
Upload `index.html`, `style.css` and `game.js` to a GitHub repository, then enable GitHub Pages from the repository root.

## Current hosting limitation
GitHub Pages is static hosting. Multiplayer uses browser-to-browser WebRTC and the room creator is the match host. A future dedicated backend will be needed for permanent maps, accounts, anti-cheat, matchmaking and always-online servers.
