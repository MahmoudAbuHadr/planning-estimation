const socket = io();

// State
let currentSessionId = null;
let isModerator = false;
let selectedCard = null;
let isRevealed = false;
let serverInfo = null;

// Fetch server info for network URL
fetch('/api/server-info')
  .then(res => res.json())
  .then(info => { serverInfo = info; })
  .catch(() => {});

// DOM Elements
const landingPage = document.getElementById('landing-page');
const sessionPage = document.getElementById('session-page');
const createNameInput = document.getElementById('create-name');
const createBtn = document.getElementById('create-btn');
const joinNameInput = document.getElementById('join-name');
const joinSessionIdInput = document.getElementById('join-session-id');
const joinBtn = document.getElementById('join-btn');
const errorMessage = document.getElementById('error-message');
const sessionIdDisplay = document.getElementById('session-id-display');
const copyLinkBtn = document.getElementById('copy-link-btn');
const moderatorBadge = document.getElementById('moderator-badge');
const participantsAroundTable = document.getElementById('participants-around-table');
const tableStatus = document.getElementById('table-status');
const cardsContainer = document.getElementById('cards-container');
const moderatorControls = document.getElementById('moderator-controls');
const revealBtn = document.getElementById('reveal-btn');
const resetBtn = document.getElementById('reset-btn');
const resultsSection = document.getElementById('results-section');
const averageDisplay = document.getElementById('average-display');

// Check for session ID in URL
const urlParams = new URLSearchParams(window.location.search);
const sessionFromUrl = urlParams.get('session');
if (sessionFromUrl) {
  joinSessionIdInput.value = sessionFromUrl;
}

// Event Listeners
createBtn.addEventListener('click', () => {
  const name = createNameInput.value.trim();
  if (!name) {
    showError('Please enter your name');
    return;
  }
  socket.emit('create-session', { name });
});

joinBtn.addEventListener('click', () => {
  const name = joinNameInput.value.trim();
  const sessionId = joinSessionIdInput.value.trim().toLowerCase();
  if (!name) {
    showError('Please enter your name');
    return;
  }
  if (!sessionId) {
    showError('Please enter session ID');
    return;
  }
  socket.emit('join-session', { sessionId, name });
});

copyLinkBtn.addEventListener('click', () => {
  // Use network IP if available, otherwise fall back to current origin
  const baseUrl = serverInfo
    ? `http://${serverInfo.ip}:${serverInfo.port}`
    : window.location.origin;
  const url = `${baseUrl}?session=${currentSessionId}`;
  navigator.clipboard.writeText(url).then(() => {
    copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyLinkBtn.textContent = 'Copy Link';
    }, 2000);
  });
});

cardsContainer.addEventListener('click', (e) => {
  if (e.target.classList.contains('card') && !isRevealed) {
    const value = parseInt(e.target.dataset.value);
    selectCard(value);
    socket.emit('vote', { value });
  }
});

revealBtn.addEventListener('click', () => {
  socket.emit('reveal');
});

resetBtn.addEventListener('click', () => {
  socket.emit('reset');
});

// Allow Enter key to submit
createNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') createBtn.click();
});

joinNameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

joinSessionIdInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

// Socket Events
socket.on('session-created', ({ sessionId }) => {
  currentSessionId = sessionId;
  isModerator = true;
  showSessionPage();
});

socket.on('session-joined', ({ sessionId, isModerator: mod }) => {
  currentSessionId = sessionId;
  isModerator = mod;
  showSessionPage();
});

socket.on('state-update', (state) => {
  updateParticipants(state.participants);

  // Check if we became moderator (promotion)
  if (state.moderatorId === socket.id && !isModerator) {
    isModerator = true;
    moderatorBadge.classList.remove('hidden');
    moderatorControls.classList.remove('hidden');
  }

  isRevealed = state.revealed;
  updateCardState();
});

socket.on('votes-revealed', ({ votes, average }) => {
  isRevealed = true;
  showResults(average);
  updateCardsOnTable(votes);
  updateCardState();
});

socket.on('votes-reset', () => {
  isRevealed = false;
  selectedCard = null;
  resultsSection.classList.add('hidden');
  clearCardSelection();
  updateCardState();
});

socket.on('error', ({ message }) => {
  showError(message);
});

// Helper Functions
function showError(message) {
  errorMessage.textContent = message;
  setTimeout(() => {
    errorMessage.textContent = '';
  }, 3000);
}

function showSessionPage() {
  landingPage.classList.add('hidden');
  sessionPage.classList.remove('hidden');
  sessionIdDisplay.textContent = currentSessionId;

  if (isModerator) {
    moderatorBadge.classList.remove('hidden');
    moderatorControls.classList.remove('hidden');
  }

  // Update URL without reload
  const url = new URL(window.location);
  url.searchParams.set('session', currentSessionId);
  window.history.replaceState({}, '', url);
}

function updateParticipants(participants) {
  // Calculate positions around the table
  const positions = getPlayerPositions(participants.length);

  // Update table status
  const votedCount = participants.filter(p => p.hasVoted).length;
  const totalCount = participants.length;
  tableStatus.textContent = `${votedCount}/${totalCount} voted`;

  // Render players around the table
  participantsAroundTable.innerHTML = participants.map((p, index) => {
    const pos = positions[index];
    const isYou = p.id === socket.id;
    const cardClass = p.hasVoted ? 'face-down' : 'no-card';

    return `
      <div class="player-seat" style="left: ${pos.x}%; top: ${pos.y}%; transform: translate(-50%, -50%);">
        <div class="player-card ${cardClass}"></div>
        <span class="player-name ${p.isModerator ? 'is-moderator' : ''} ${isYou ? 'is-you' : ''}">
          ${escapeHtml(p.name)}${isYou ? ' (you)' : ''}
        </span>
      </div>
    `;
  }).join('');
}

// Calculate evenly distributed positions around an ellipse
function getPlayerPositions(count) {
  const positions = [];
  const centerX = 50;
  const centerY = 50;
  const radiusX = 42; // Horizontal radius (percentage)
  const radiusY = 38; // Vertical radius (percentage)

  for (let i = 0; i < count; i++) {
    // Start from top and go clockwise
    const angle = (Math.PI * 2 * i / count) - Math.PI / 2;
    positions.push({
      x: centerX + radiusX * Math.cos(angle),
      y: centerY + radiusY * Math.sin(angle)
    });
  }
  return positions;
}

// Update cards on the table when votes are revealed
function updateCardsOnTable(votes) {
  const positions = getPlayerPositions(votes.length);

  tableStatus.textContent = 'Votes revealed!';

  participantsAroundTable.innerHTML = votes.map((v, index) => {
    const pos = positions[index];
    const isYou = v.id === socket.id;
    const hasVote = v.vote !== null;
    const displayValue = hasVote ? v.vote : '?';

    const cardContent = hasVote
      ? `<span class="corner top">${displayValue}</span>
         <span class="center-value">${displayValue}</span>
         <span class="corner bottom">${displayValue}</span>`
      : '?';

    return `
      <div class="player-seat" style="left: ${pos.x}%; top: ${pos.y}%; transform: translate(-50%, -50%);">
        <div class="player-card ${hasVote ? 'revealed' : 'no-vote'}">
          ${cardContent}
        </div>
        <span class="player-name ${v.isModerator ? 'is-moderator' : ''} ${isYou ? 'is-you' : ''}">
          ${escapeHtml(v.name)}${isYou ? ' (you)' : ''}
        </span>
      </div>
    `;
  }).join('');
}

function selectCard(value) {
  selectedCard = value;
  document.querySelectorAll('.card').forEach(card => {
    card.classList.remove('selected');
    if (parseInt(card.dataset.value) === value) {
      card.classList.add('selected');
    }
  });
}

function clearCardSelection() {
  selectedCard = null;
  document.querySelectorAll('.card').forEach(card => {
    card.classList.remove('selected');
  });
}

function updateCardState() {
  document.querySelectorAll('.card').forEach(card => {
    if (isRevealed) {
      card.classList.add('disabled');
    } else {
      card.classList.remove('disabled');
    }
  });
}

function showResults(average) {
  resultsSection.classList.remove('hidden');

  if (average !== null) {
    averageDisplay.innerHTML = `Average: <strong>${average}</strong>`;
  } else {
    averageDisplay.innerHTML = 'No votes to average';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
