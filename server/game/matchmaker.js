const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../routes/auth');
const { calculateElo } = require('./elo');

// ── State ──
const waitingPlayers = [];   // players looking for a game
const activeGames = new Map(); // gameId -> GameSession

// ─────────────────────────────────────────────
// CONNECTION ENTRY POINT
// ─────────────────────────────────────────────
function handleConnection(ws, req) {
  let player = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'auth':       return handleAuth(ws, msg, (p) => { player = p; });
      case 'find_match': return handleFindMatch(ws, player);
      case 'cancel':     return handleCancel(ws, player);
      case 'move':       return handleMove(ws, player, msg);
      case 'resign':     return handleResign(ws, player);
      case 'ping':       return send(ws, { type: 'pong' });
    }
  });

  ws.on('close', () => {
    if (player) {
      removeFromQueue(ws);
      handleDisconnect(player);
    }
  });

  ws.on('error', () => {});
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────
function handleAuth(ws, msg, setPlayer) {
  try {
    const decoded = jwt.verify(msg.token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    if (!user) return send(ws, { type: 'error', message: 'User not found.' });
    const player = { ws, id: user.id, username: user.username, rating: user.rating, games: user.games };
    setPlayer(player);
    send(ws, { type: 'authed', user: safeUser(user) });
  } catch {
    send(ws, { type: 'error', message: 'Invalid token.' });
  }
}

// ─────────────────────────────────────────────
// MATCHMAKING
// ─────────────────────────────────────────────
function handleFindMatch(ws, player) {
  if (!player) return send(ws, { type: 'error', message: 'Not authenticated.' });

  // Don't add duplicate
  if (waitingPlayers.find(p => p.id === player.id)) return;

  waitingPlayers.push(player);
  send(ws, { type: 'searching' });

  // Try to pair
  tryPair();
}

function tryPair() {
  if (waitingPlayers.length < 2) return;

  // Simple: pair first two (can add rating-based matching later)
  const p1 = waitingPlayers.shift();
  const p2 = waitingPlayers.shift();

  // Sanity check both sockets still open
  if (p1.ws.readyState !== 1 || p2.ws.readyState !== 1) {
    if (p1.ws.readyState === 1) waitingPlayers.unshift(p1);
    if (p2.ws.readyState === 1) waitingPlayers.unshift(p2);
    return;
  }

  startGame(p1, p2);
}

function handleCancel(ws, player) {
  if (player) removeFromQueue(ws);
  send(ws, { type: 'cancelled' });
}

function removeFromQueue(ws) {
  const idx = waitingPlayers.findIndex(p => p.ws === ws);
  if (idx !== -1) waitingPlayers.splice(idx, 1);
}

// ─────────────────────────────────────────────
// GAME SESSION
// ─────────────────────────────────────────────
function startGame(white, black) {
  const gameId = uuidv4();

  const session = {
    id: gameId,
    white,
    black,
    moves: [],
    turn: 'white',
    startedAt: Date.now(),
    timer: null,
    timerVal: 10,
    over: false,
  };

  activeGames.set(gameId, session);

  // Record in DB
  db.prepare(`INSERT INTO games (id, white_id, black_id, white_rating, black_rating, moves)
    VALUES (?, ?, ?, ?, ?, '[]')`).run(gameId, white.id, black.id, white.rating, black.rating);

  const gameInfo = {
    type: 'game_start',
    gameId,
    white: { username: white.username, rating: white.rating },
    black: { username: black.username, rating: black.rating },
  };

  send(white.ws, { ...gameInfo, color: 'white' });
  send(black.ws, { ...gameInfo, color: 'black' });

  startTurnTimer(session, 'white');
}

// ─────────────────────────────────────────────
// MOVES
// ─────────────────────────────────────────────
function handleMove(ws, player, msg) {
  if (!player) return;

  const session = findGameByPlayer(player);
  if (!session || session.over) return;

  const color = session.white.id === player.id ? 'white' : 'black';
  if (session.turn !== color) return; // not your turn

  const { from, to, san, evalBefore, evalAfter } = msg;
  const delta = (evalAfter || 0) - (evalBefore || 0);
  const BLUNDER_THRESHOLD = -2.0; // 200 centipawns expressed as pawns

  const move = { color, from, to, san, evalBefore, evalAfter, delta, timestamp: Date.now() };
  session.moves.push(move);

  stopTurnTimer(session);

  const isBlunder = color === 'white'
    ? delta < BLUNDER_THRESHOLD
    : delta > -BLUNDER_THRESHOLD; // from black's perspective

  // Broadcast move to both players
  broadcast(session, {
    type: 'move',
    color,
    from, to, san, evalBefore, evalAfter, delta,
    isBlunder,
  });

  if (isBlunder) {
    const winner = color === 'white' ? 'black' : 'white';
    endGame(session, winner, `${player.username} blundered — ${san} (${Math.round(Math.abs(delta)*100)}cp drop)`);
    return;
  }

  // Switch turn
  session.turn = color === 'white' ? 'black' : 'white';
  startTurnTimer(session, session.turn);
}

// ─────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────
function startTurnTimer(session, color) {
  session.timerVal = 10;
  session.timer = setInterval(() => {
    session.timerVal--;
    broadcast(session, { type: 'timer', color, value: session.timerVal });
    if (session.timerVal <= 0) {
      stopTurnTimer(session);
      const winner = color === 'white' ? 'black' : 'white';
      const p = color === 'white' ? session.white : session.black;
      endGame(session, winner, `${p.username} ran out of time`);
    }
  }, 1000);
}

function stopTurnTimer(session) {
  if (session.timer) { clearInterval(session.timer); session.timer = null; }
}

// ─────────────────────────────────────────────
// RESIGN / DISCONNECT
// ─────────────────────────────────────────────
function handleResign(ws, player) {
  if (!player) return;
  const session = findGameByPlayer(player);
  if (!session || session.over) return;
  const color = session.white.id === player.id ? 'white' : 'black';
  const winner = color === 'white' ? 'black' : 'white';
  endGame(session, winner, `${player.username} resigned`);
}

function handleDisconnect(player) {
  const session = findGameByPlayer(player);
  if (!session || session.over) return;
  const color = session.white.id === player.id ? 'white' : 'black';
  const winner = color === 'white' ? 'black' : 'white';
  endGame(session, winner, `${player.username} disconnected`);
}

// ─────────────────────────────────────────────
// END GAME
// ─────────────────────────────────────────────
function endGame(session, winnerColor, reason) {
  if (session.over) return;
  session.over = true;
  stopTurnTimer(session);

  const winner = winnerColor === 'white' ? session.white : session.black;
  const loser  = winnerColor === 'white' ? session.black : session.white;

  const winnerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(winner.id);
  const loserUser  = db.prepare('SELECT * FROM users WHERE id = ?').get(loser.id);

  const elo = calculateElo(winnerUser.rating, loserUser.rating, winnerUser.games, loserUser.games);

  // Update DB
  const updateUser = db.prepare(`
    UPDATE users SET
      rating = ?, peak_rating = MAX(peak_rating, ?),
      wins = wins + ?, losses = losses + ?,
      games = games + 1,
      no_ads = CASE WHEN MAX(peak_rating, ?) >= 1600 THEN 1 ELSE no_ads END
    WHERE id = ?
  `);

  updateUser.run(elo.winnerNew, elo.winnerNew, 1, 0, elo.winnerNew, winner.id);
  updateUser.run(elo.loserNew,  elo.loserNew,  0, 1, elo.loserNew,  loser.id);

  const duration = Math.round((Date.now() - session.startedAt) / 1000);

  db.prepare(`
    UPDATE games SET
      winner_id = ?, end_reason = ?, moves = ?,
      white_delta = ?, black_delta = ?,
      duration_secs = ?, ended_at = datetime('now')
    WHERE id = ?
  `).run(
    winner.id, reason,
    JSON.stringify(session.moves),
    winnerColor === 'white' ? elo.winnerDelta : elo.loserDelta,
    winnerColor === 'black' ? elo.winnerDelta : elo.loserDelta,
    duration, session.id
  );

  // Notify players
  const result = {
    type: 'game_over',
    reason,
    winner: winnerColor,
    winnerUsername: winner.username,
    ratings: {
      white: { old: winnerColor==='white'?winnerUser.rating:loserUser.rating, new: winnerColor==='white'?elo.winnerNew:elo.loserNew, delta: winnerColor==='white'?elo.winnerDelta:elo.loserDelta },
      black: { old: winnerColor==='black'?winnerUser.rating:loserUser.rating, new: winnerColor==='black'?elo.winnerNew:elo.loserNew, delta: winnerColor==='black'?elo.winnerDelta:elo.loserDelta },
    },
    noAdsUnlocked: {
      white: elo.winnerNew >= 1600 && winnerColor === 'white' && !winnerUser.no_ads,
      black: elo.winnerNew >= 1600 && winnerColor === 'black' && !winnerUser.no_ads,
    }
  };

  broadcast(session, result);
  activeGames.delete(session.id);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function broadcast(session, msg) {
  send(session.white.ws, msg);
  send(session.black.ws, msg);
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function findGameByPlayer(player) {
  for (const session of activeGames.values()) {
    if (session.white.id === player.id || session.black.id === player.id) return session;
  }
  return null;
}

function safeUser(u) {
  return { id: u.id, username: u.username, rating: u.rating, peak_rating: u.peak_rating, wins: u.wins, losses: u.losses, games: u.games, no_ads: u.no_ads === 1 };
}

module.exports = { handleConnection };
