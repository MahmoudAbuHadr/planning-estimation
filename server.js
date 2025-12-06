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
      revealed: false
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

    console.log(`${name} joined session ${sessionId}`);
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

  // Reset for next round (moderator only)
  socket.on('reset', () => {
    if (!currentSessionId || !sessions[currentSessionId]) return;

    const session = sessions[currentSessionId];
    if (socket.id !== session.moderatorId) return;

    // Clear all votes
    Object.keys(session.participants).forEach(id => {
      session.participants[id].vote = null;
    });
    session.revealed = false;

    io.to(currentSessionId).emit('state-update', getSessionState(session));
    io.to(currentSessionId).emit('votes-reset');

    console.log(`Votes reset in session ${currentSessionId}`);
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
