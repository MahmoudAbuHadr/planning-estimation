# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm install    # Install dependencies
npm start      # Start server on port 3000 (or PORT env var)
```

The server displays both localhost and network URLs on startup.

## Architecture

This is a real-time planning poker application for agile estimation sessions.

### Tech Stack
- **Backend**: Node.js + Express + Socket.IO
- **Frontend**: Plain HTML/CSS/JavaScript (no framework)
- **State**: In-memory only, no database

### File Structure
- `server.js` - Express server with Socket.IO event handlers, session management, and all business logic
- `public/index.html` - Single-page UI with landing and session views
- `public/app.js` - Client-side Socket.IO logic, state management, DOM manipulation
- `public/style.css` - Poker table styling with CSS gradients and animations

### Key Concepts

**Sessions**: In-memory objects keyed by 6-character session IDs. Each session has:
- `moderatorId` - socket ID of the session owner
- `participants` - map of socket ID to `{name, vote}`
- `revealed` - boolean for vote visibility
- `history` - array of completed rounds with averages

**Socket Events**:
- Client → Server: `create-session`, `join-session`, `rejoin-session`, `vote`, `reveal`, `reset-votes`, `new-round`, `clear-history`, `promote-moderator`
- Server → Client: `session-created`, `session-joined`, `state-update`, `votes-revealed`, `votes-reset`, `history-update`, `error`, `rejoin-failed`

**State Flow**: Server is single source of truth. `state-update` broadcasts participant info (hiding vote values). `votes-revealed` includes actual values only after moderator reveals.

**Session Persistence**: Client uses localStorage to auto-rejoin after page refresh. Username is remembered across sessions.
