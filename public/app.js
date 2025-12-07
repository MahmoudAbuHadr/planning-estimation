const socket = io();

// State
let currentSessionId = null;
let isModerator = false;
let selectedCard = null;
let isRevealed = false;
let serverInfo = null;

// localStorage persistence
const STORAGE_KEY = 'planning-poker-session';
const USERNAME_KEY = 'planning-poker-username';

function saveSession(sessionId, userName, isModerator) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, userName, isModerator }));
  localStorage.setItem(USERNAME_KEY, userName); // Remember username separately
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function loadUsername() {
  return localStorage.getItem(USERNAME_KEY) || '';
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  // Keep USERNAME_KEY so name is remembered
}

// Attempt to rejoin saved session on page load
socket.on('connect', () => {
  const saved = loadSession();
  if (saved) {
    socket.emit('rejoin-session', {
      sessionId: saved.sessionId,
      name: saved.userName,
      wasModerator: saved.isModerator
    });
  }
});

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
const resetVotesBtn = document.getElementById('reset-votes-btn');
const newRoundBtn = document.getElementById('new-round-btn');
const resultsSection = document.getElementById('results-section');
const averageDisplay = document.getElementById('average-display');
const historySection = document.getElementById('history-section');
const historyList = document.getElementById('history-list');
const historySummary = document.getElementById('history-summary');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const contextMenu = document.getElementById('context-menu');
const promoteBtn = document.getElementById('promote-btn');
const resultModal = document.getElementById('result-modal');
const resultValue = document.getElementById('result-value');
const resultName = document.getElementById('result-name');
const resultCancelBtn = document.getElementById('result-cancel-btn');
const resultSubmitBtn = document.getElementById('result-submit-btn');

// Context menu state
let contextMenuTargetId = null;

// Check for session ID in URL
const urlParams = new URLSearchParams(window.location.search);
const sessionFromUrl = urlParams.get('session');
if (sessionFromUrl) {
  joinSessionIdInput.value = sessionFromUrl;
}

// Pre-fill name fields with remembered username
const rememberedName = loadUsername();
if (rememberedName) {
  createNameInput.value = rememberedName;
  joinNameInput.value = rememberedName;
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

  copyToClipboard(url).then(() => {
    copyLinkBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyLinkBtn.textContent = 'Copy Link';
    }, 2000);
  }).catch(() => {
    // If clipboard fails, show the URL in a prompt
    prompt('Copy this link:', url);
  });
});

// Clipboard helper with fallback for non-HTTPS contexts
function copyToClipboard(text) {
  // Try modern clipboard API first
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }

  // Fallback for non-secure contexts (like http:// on network IP)
  return new Promise((resolve, reject) => {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      document.execCommand('copy');
      document.body.removeChild(textArea);
      resolve();
    } catch (err) {
      document.body.removeChild(textArea);
      reject(err);
    }
  });
}

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

resetVotesBtn.addEventListener('click', () => {
  socket.emit('reset-votes');
});

newRoundBtn.addEventListener('click', () => {
  socket.emit('new-round');
});

clearHistoryBtn.addEventListener('click', () => {
  socket.emit('clear-history');
});

// Result modal handlers
resultCancelBtn.addEventListener('click', () => {
  resultModal.classList.add('hidden');
  resultName.value = '';
  resultValue.value = '1';
});

resultSubmitBtn.addEventListener('click', () => {
  const result = resultValue.value;
  const name = resultName.value.trim();
  socket.emit('submit-round-result', { result, name });
  resultModal.classList.add('hidden');
  resultName.value = '';
  resultValue.value = '1';
});

// Context menu for promoting participants (moderator only)
participantsAroundTable.addEventListener('contextmenu', (e) => {
  const playerSeat = e.target.closest('.player-seat');
  if (!playerSeat || !isModerator) return;

  const participantId = playerSeat.dataset.participantId;
  // Don't show menu for self
  if (participantId === socket.id) return;

  e.preventDefault();
  contextMenuTargetId = participantId;

  // Position the context menu
  contextMenu.style.left = `${e.clientX}px`;
  contextMenu.style.top = `${e.clientY}px`;
  contextMenu.classList.remove('hidden');
});

// Hide context menu on click elsewhere
document.addEventListener('click', () => {
  contextMenu.classList.add('hidden');
  contextMenuTargetId = null;
});

// Promote button click
promoteBtn.addEventListener('click', () => {
  if (contextMenuTargetId) {
    socket.emit('promote-moderator', { targetId: contextMenuTargetId });
    contextMenu.classList.add('hidden');
    contextMenuTargetId = null;
  }
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
  saveSession(sessionId, createNameInput.value.trim(), true);
  showSessionPage();
});

socket.on('session-joined', ({ sessionId, isModerator: mod, userName }) => {
  currentSessionId = sessionId;
  isModerator = mod;
  // Use userName from server (may be auto-renamed if duplicate)
  const name = userName || joinNameInput.value.trim();
  saveSession(sessionId, name, mod);
  showSessionPage();
});

socket.on('state-update', (state) => {
  updateParticipants(state.participants);

  // Check if moderator status changed
  const wasModerator = isModerator;
  const isNowModerator = state.moderatorId === socket.id;

  if (isNowModerator && !wasModerator) {
    // Promoted to moderator
    isModerator = true;
    moderatorBadge.classList.remove('hidden');
    moderatorControls.classList.remove('hidden');
    // Update localStorage
    const saved = loadSession();
    if (saved) {
      saveSession(saved.sessionId, saved.userName, true);
    }
  } else if (!isNowModerator && wasModerator) {
    // Demoted from moderator
    isModerator = false;
    moderatorBadge.classList.add('hidden');
    moderatorControls.classList.add('hidden');
    // Update localStorage
    const saved = loadSession();
    if (saved) {
      saveSession(saved.sessionId, saved.userName, false);
    }
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

socket.on('history-update', ({ history }) => {
  updateHistory(history);
});

socket.on('prompt-result', ({ roundNumber }) => {
  // Show modal for moderator to enter result
  resultName.placeholder = `Round ${roundNumber} (or custom name)`;
  resultModal.classList.remove('hidden');
  resultValue.focus();
});

socket.on('error', ({ message }) => {
  showError(message);
  if (message === 'Session not found') {
    clearSession();
  }
});

socket.on('rejoin-failed', () => {
  clearSession();
  // Name fields already pre-filled from loadUsername() on page load
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
    const canPromote = isModerator && !isYou;

    return `
      <div class="player-seat ${canPromote ? 'can-promote' : ''}" data-participant-id="${p.id}" style="left: ${pos.x}%; top: ${pos.y}%; transform: translate(-50%, -50%);">
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
    const canPromote = isModerator && !isYou;

    const joker = '🃏';
    const cardContent = hasVote
      ? `<span class="corner top">${displayValue}</span>
         <span class="center-value">${displayValue}</span>
         <span class="corner bottom">${displayValue}</span>`
      : `<span class="corner top">${joker}</span>
         <span class="center-value">${joker}</span>
         <span class="corner bottom">${joker}</span>`;

    return `
      <div class="player-seat ${canPromote ? 'can-promote' : ''}" data-participant-id="${v.id}" style="left: ${pos.x}%; top: ${pos.y}%; transform: translate(-50%, -50%);">
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

function updateHistory(history) {
  if (history.length === 0) {
    historySection.classList.add('hidden');
    return;
  }

  historySection.classList.remove('hidden');

  // Show/hide clear history button based on moderator status
  if (isModerator) {
    clearHistoryBtn.classList.remove('hidden');
  } else {
    clearHistoryBtn.classList.add('hidden');
  }

  // Render history items (using name and result instead of average)
  // Moderator can click on name to edit it
  historyList.innerHTML = history.map((item, index) => `
    <div class="history-item">
      <span class="round-name ${isModerator ? 'editable' : ''}" data-index="${index}">${escapeHtml(item.name)}</span>
      <span class="round-result">${item.result}</span>
    </div>
  `).join('');

  // Add click handlers for editable names (moderator only)
  if (isModerator) {
    historyList.querySelectorAll('.round-name.editable').forEach(span => {
      span.addEventListener('click', startEditingRoundName);
    });
  }

  // Calculate and show summary
  const totalRounds = history.length;
  const totalPoints = history.reduce((sum, item) => sum + item.result, 0);

  historySummary.innerHTML = `
    <span class="total-label">Total: ${totalRounds} rounds</span>
    <span class="total-value">${totalPoints} points</span>
  `;
}

// Start editing a round name inline
function startEditingRoundName(e) {
  const span = e.target;
  const index = parseInt(span.dataset.index);
  const currentName = span.textContent;

  // Create input element
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'round-name-input';
  input.maxLength = 50;

  // Replace span with input
  span.replaceWith(input);
  input.focus();
  input.select();

  // Save on Enter or blur
  const saveEdit = () => {
    const newName = input.value.trim();
    socket.emit('update-round-name', { index, name: newName });
    // The history-update event will re-render with the new name
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      // Cancel edit - re-render history
      socket.emit('update-round-name', { index, name: currentName });
    }
  });

  input.addEventListener('blur', saveEdit);
}
