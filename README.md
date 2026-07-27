# BlockWorld Multiplayer

A small Minecraft-style browser game that can be hosted on GitHub Pages.

## Features
- First-person movement
- Break and place five block types
- Generated block world
- Solo mode
- Multiplayer room codes with PeerJS/WebRTC
- Basic mobile controls

## Publish on GitHub Pages
1. Create a new public GitHub repository.
2. Upload `index.html`, `style.css`, and `game.js` to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. Open the Pages address GitHub provides.

## Multiplayer model
GitHub Pages only serves static files, so this starter uses PeerJS/WebRTC. One player creates the room and acts as the world host. The room ends when the host closes the page. This version does not have accounts, a database, permanent worlds, anti-cheat, enemies, crafting, or dedicated servers.

## Controls
- WASD: move
- Space: jump
- Shift: sprint
- Mouse: look
- Left click: break block
- Right click: place block
- 1–5: select block
