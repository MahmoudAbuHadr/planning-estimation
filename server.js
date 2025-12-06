const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Get local network IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory sessions store
const sessions = {};

// Generate random session ID
function generateSessionId() {
  return Math.random().toString(36).substring(2, 8);
}

// Get session state to broadcast (hides vote values unless revealed)
function getSessionState(session) {
  const participants = Object.entries(session.participants).map(([socketId, data]) => ({
    id: socketId,
    name: data.name,
    hasVoted: data.vote !== null,
    isModerator: socketId === session.moderatorId
  }));

  return {
    participants,
    revealed: session.revealed,
    moderatorId: session.moderatorId
  };
}

// Check if all votes are unanimous (everyone voted the same)
function getUnanimousVote(session) {
  const votes = Object.values(session.participants)
    .map(p => p.vote)
    .filter(v => v !== null);
  if (votes.length === 0) return null;
  return votes.every(v => v === votes[0]) ? votes[0] : null;
}

// Get revealed votes (includes actual vote values)
function getRevealedVotes(session) {
  const votes = Object.entries(session.participants).map(([socketId, data]) => ({
    id: socketId,
    name: data.name,
    vote: data.vote,
    isModerator: socketId === session.moderatorId
  }));

  const validVotes = votes.filter(v => v.vote !== null).map(v => v.vote);
  const average = validVotes.length > 0
    ? (validVotes.reduce((a, b) => a + b, 0) / validVotes.length).toFixed(1)
    : null;

  return { votes, average };
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  let currentSessionId = null;

  // Create a new session
  socket.on('create-session', ({ name }) => {
    const sessionId = generateSessionId();

    sessions[sessionId] = {
      moderatorId: socket.id,
      participants: {
        [socket.id]: { name, vote: null }
      },
      revealed: false,
      history: []
    };

    currentSessionId = sessionId;
    socket.join(sessionId);

    socket.emit('session-created', { sessionId });
    io.to(sessionId).emit('state-update', getSessionState(sessions[sessionId]));

    console.log(`Session ${sessionId} created by ${name}`);
  });

  // Join an existing session
  socket.on('join-session', ({ sessionId, name }) => {
    const session = sessions[sessionId];

    if (!session) {
      socket.emit('error', { message: 'Session not found' });
      return;
    }

    session.participants[socket.id] = { name, vote: null };
    currentSessionId = sessionId;
    socket.join(sessionId);

    socket.emit('session-joined', {
      sessionId,
      isModerator: false
    });
    io.to(sessionId).emit('state-update', getSessionState(session));

    // If votes were already revealed, send them to the new participant
    if (session.revealed) {
      socket.emit('votes-revealed', getRevealedVotes(session));
    }

    // Send history to new participant
    if (session.history.length > 0) {
      socket.emit('history-update', { history: session.history });
    }

    console.log(`${name} joined session ${sessionId}`);
  });

  // Rejoin after page refresh
  socket.on('rejoin-session', ({ sessionId, name, wasModerator }) => {
    const session = sessions[sessionId];

    if (!session) {
      socket.emit('rejoin-failed', { reason: 'session-not-found' });
      return;
    }

    // Check if name already exists (different socket)
    let finalName = name;
    const existingNames = Object.values(session.participants).map(p => p.name);

    if (existingNames.includes(name)) {
      // Auto-rename: "Alice" → "Alice (2)", "Alice (3)", etc.
      let counter = 2;
      while (existingNames.includes(`${name} (${counter})`)) {
        counter++;
      }
      finalName = `${name} (${counter})`;
    }

    // Restore moderator status if they were moderator and current moderator slot is "orphaned"
    let becomeModerator = false;
    if (wasModerator && !session.participants[session.moderatorId]) {
      session.moderatorId = socket.id;
      becomeModerator = true;
    }

    session.participants[socket.id] = { name: finalName, vote: null };
    currentSessionId = sessionId;
    socket.join(sessionId);

    socket.emit('session-joined', {
      sessionId,
      isModerator: becomeModerator,
      userName: finalName
    });
    io.to(sessionId).emit('state-update', getSessionState(session));

    if (session.revealed) {
      socket.emit('votes-revealed', getRevealedVotes(session));
    }

    // Send history to rejoining participant
    if (session.history.length > 0) {
      socket.emit('history-update', { history: session.history });
    }

    console.log(`${finalName} rejoined session ${sessionId}`);
  });

  // Submit a vote
  socket.on('vote', ({ value }) => {
    if (!currentSessionId || !sessions[currentSessionId]) return;

    const session = sessions[currentSessionId];
    if (!session.participants[socket.id]) return;

    // Can't vote if already revealed
    if (session.revealed) return;

    session.participants[socket.id].vote = value;
    io.to(currentSessionId).emit('state-update', getSessionState(session));

    console.log(`Vote received in session ${currentSessionId}`);
  });

  // Reveal votes (moderator only)
  socket.on('reveal', () => {
    if (!currentSessionId || !sessions[currentSessionId]) return;

    const session = sessions[currentSessionId];
    if (socket.id !== session.moderatorId) return;

    session.revealed = true;
    io.to(currentSessionId).emit('votes-revealed', getRevealedVotes(session));

    console.log(`Votes revealed in session ${currentSessionId}`);
  });

  // Reset votes without saving to history (moderator only)
  socket.on('reset-votes', () => {
    if (!currentSessionId || !sessions[currentSessionId]) return;

    const session = sessions[currentSessionId];
    if (socket.id !== session.moderatorId) return;

    // Clear all votes without saving to history
    Object.keys(session.participants).forEach(id => {
      session.participants[id].vote = null;
    });
    session.revealed = false;

    io.to(currentSessionId).emit('state-update', getSessionState(session));
    io.to(currentSessionId).emit('votes-reset');

    console.log(`Votes reset (no save) in session ${currentSessionId}`);
  });

  // New round - check for unanimous vote or prompt for result (moderator only)
  socket.on('new-round', () => {
    if (!currentSessionId || !sessions[currentSessionId]) return;

    const session = sessions[currentSessionId];
    if (socket.id !== session.moderatorId) return;

    // Only proceed if votes were revealed
    if (!session.revealed) return;

    // Check for unanimous vote
    const unanimousVote = getUnanimousVote(session);

    if (unanimousVote !== null) {
      // 100% agreement - auto-save and proceed
      const roundName = `Round ${session.history.length + 1}`;
      session.history.push({ name: roundName, result: unanimousVote });
      io.to(currentSessionId).emit('history-update', { history: session.history });

      // Clear all votes
      Object.keys(session.participants).forEach(id => {
        session.participants[id].vote = null;
      });
      session.revealed = false;

      io.to(currentSessionId).emit('state-update', getSessionState(session));
      io.to(currentSessionId).emit('votes-reset');

      console.log(`New round (unanimous: ${unanimousVote}) in session ${currentSessionId}`);
    } else {
      // No agreement - prompt moderator for result
      socket.emit('prompt-result', { roundNumber: session.history.length + 1 });
    }
  });

  // Submit round result after prompt (moderator only)
  socket.on('submit-round-result', ({ result, name }) => {
    if (!currentSessionId || !sessions[currentSessionId]) return;

    const session = sessions[currentSessionId];
    if (socket.id !== session.moderatorId) return;

    // Save to history with provided name or default
    const roundName = name && name.trim() ? name.trim() : `Round ${session.history.length + 1}`;
    session.history.push({ name: roundName, result: parseInt(result) });
    io.to(currentSessionId).emit('history-update', { history: session.history });

    // Clear all votes
    Object.keys(session.participants).forEach(id => {
      session.participants[id].vote = null;
    });
    session.revealed = false;

    io.to(currentSessionId).emit('state-update', getSessionState(session));
    io.to(currentSessionId).emit('votes-reset');

    console.log(`New round (result: ${result}) in session ${currentSessionId}, history: ${session.history.length} rounds`);
  });

  // Update round name in history (moderator only)
  socket.on('update-round-name', ({ index, name }) => {
    if (!currentSessionId || !sessions[currentSessionId]) return;

    const session = sessions[currentSessionId];
    if (socket.id !== session.moderatorId) return;

    // Validate index
    if (index < 0 || index >= session.history.length) return;

    // Update the name
    session.history[index].name = name && name.trim() ? name.trim() : `Round ${index + 1}`;
    io.to(currentSessionId).emit('history-update', { history: session.history });

    console.log(`Round ${index + 1} renamed to "${session.history[index].name}" in session ${currentSessionId}`);
  });

  // Clear all history (moderator only)
  socket.on('clear-history', () => {
    if (!currentSessionId || !sessions[currentSessionId]) return;

    const session = sessions[currentSessionId];
    if (socket.id !== session.moderatorId) return;

    session.history = [];
    io.to(currentSessionId).emit('history-update', { history: session.history });

    console.log(`History cleared in session ${currentSessionId}`);
  });

  // Promote another participant to moderator (current moderator only)
  socket.on('promote-moderator', ({ targetId }) => {
    if (!currentSessionId || !sessions[currentSessionId]) return;

    const session = sessions[currentSessionId];

    // Only current moderator can promote
    if (socket.id !== session.moderatorId) return;

    // Target must exist in session
    if (!session.participants[targetId]) return;

    // Can't promote yourself
    if (targetId === socket.id) return;

    // Transfer moderator status
    session.moderatorId = targetId;

    // Notify all clients of the change
    io.to(currentSessionId).emit('state-update', getSessionState(session));

    console.log(`Moderator changed in session ${currentSessionId}: ${session.participants[targetId].name}`);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    if (!currentSessionId || !sessions[currentSessionId]) return;

    const session = sessions[currentSessionId];
    const wasModerator = socket.id === session.moderatorId;

    delete session.participants[socket.id];

    // If no participants left, delete the session
    if (Object.keys(session.participants).length === 0) {
      delete sessions[currentSessionId];
      console.log(`Session ${currentSessionId} deleted (empty)`);
      return;
    }

    // If moderator left, promote the first participant
    if (wasModerator) {
      const newModeratorId = Object.keys(session.participants)[0];
      session.moderatorId = newModeratorId;
      console.log(`New moderator in session ${currentSessionId}: ${session.participants[newModeratorId].name}`);
    }

    io.to(currentSessionId).emit('state-update', getSessionState(session));
  });
});

const PORT = process.env.PORT || 3000;
const LOCAL_IP = getLocalIP();

// API endpoint to get server info (for copy link)
app.get('/api/server-info', (req, res) => {
  res.json({ ip: LOCAL_IP, port: PORT });
});

server.listen(PORT, () => {
  console.log(`Planning Poker server running on:`);
  console.log(`  - Local:   http://localhost:${PORT}`);
  console.log(`  - Network: http://${LOCAL_IP}:${PORT}`);
});
