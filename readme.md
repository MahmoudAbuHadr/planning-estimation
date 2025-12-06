# Planning Poker App

A simple planning poker app for agile teams to collaboratively estimate user stories.

## What is Planning Poker?

Planning Poker is a consensus-based estimation technique where agile teams collaboratively estimate product backlog items using relative sizing. Team members vote simultaneously to prevent groupthink and anchoring bias.

Reference: [Mountain Goat Software - Planning Poker](https://www.mountaingoatsoftware.com/agile/planning-poker)

---

## Quick Start

```bash
npm install
npm start
```

Server will display:
```
Planning Poker server running on:
  - Local:   http://localhost:3000
  - Network: http://192.168.x.x:3000
```

Share the **Network** URL with teammates on your local network.

---

## Core Features

### 1. Session Management
- Moderator creates a new poker session
- Share session link with teammates (auto-detects network IP)
- Participants join an existing session via link

### 2. Poker Table UI
- Visual poker table with green felt and wood border
- Players positioned around the table
- Face-down cards (blue) when voted but not revealed
- Empty card slots for players who haven't voted
- Vote counter in center (e.g., "3/5 voted")

### 3. Voting
- Card values: **1, 2, 3, 5, 8, 13, 20**
- Select a card (vote is hidden until reveal)
- Change vote before reveal

### 4. Reveal & Results (Moderator Only)
- Moderator triggers reveal (all cards flip simultaneously)
- Cards on table show actual vote values
- Playing card style results with corner values
- Show average score
- Moderator resets for next round

### 5. Player Indicators
- Green badge = Moderator
- Gold border = You
- "(you)" suffix on your name

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| Story/Item Tracking | No - discuss verbally, app for voting only |
| Persistence | No - in-memory only, resets on refresh |
| Roles | 1 Moderator (controls reveal/reset), N Participants |
| Card Values | 1, 2, 3, 5, 8, 13, 20 |

---

## Tech Stack

Simple and minimal:

- **Frontend**: Plain HTML, CSS, JavaScript (no framework)
- **Backend**: Node.js with Express
- **Real-time**: Socket.IO (simpler than raw WebSockets, has built-in rooms)
- **No database** - all state in memory

---

## State Management

### Server-Side (Single Source of Truth)

All state lives in memory on the server:

```javascript
const sessions = {
  "abc123": {
    moderatorId: "socket-id-1",
    participants: {
      "socket-id-1": { name: "Alice", vote: null },
      "socket-id-2": { name: "Bob", vote: 5 },
      "socket-id-3": { name: "Carol", vote: 8 }
    },
    revealed: false
  }
}
```

### Client-Side (Minimal)

- Its own socket ID
- Current session state (received from server)
- UI state (which card is selected)

---

## Real-Time State Sharing

Using Socket.IO rooms for session-based broadcasting:

```
┌─────────────────────────────────────────────────────────────┐
│                      SERVER (Node.js)                       │
│                                                             │
│  sessions["abc123"] = { ... }                               │
└─────────────────────────────────────────────────────────────┘
        ▲           │           │           │
        │           ▼           ▼           ▼
    emit()    broadcast()  broadcast()  broadcast()
        │           │           │           │
┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│  Alice    │ │   Bob     │ │  Carol    │ │   Dave    │
│(Moderator)│ │(Participant)│(Participant)│(Participant)│
└───────────┘ └───────────┘ └───────────┘ └───────────┘
```

### Events & Data Flow

| Event | Server Sends | Data |
|-------|--------------|------|
| Join | `state-update` | All participants (names + hasVoted) |
| Vote | `state-update` | Updated hasVoted (NOT the vote value) |
| Leave | `state-update` | Updated participant list |
| Reveal | `votes-revealed` | All votes + names + average |
| Reset | `state-update` | Votes cleared, revealed=false |

**Key**: Vote values stay hidden on server until moderator reveals.

---

## File Structure

```
planning-poker/
├── server.js           # Express + Socket.IO server
├── package.json        # Dependencies
├── public/
│   ├── index.html      # Single page UI
│   ├── style.css       # Poker table & card styling
│   └── app.js          # Client-side Socket.IO logic
└── readme.md           # This file
```
