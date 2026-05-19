const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../routes/auth');
const { calculateElo } = require('./elo');

const waitingPlayers = [];
const activeGames = new Map();

function handleConnection(ws, req) {
  let player = null;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    switch(msg.type) {
      case 'auth':       return handleAuth(ws, msg, (p) => { player = p; });
      case 'find_match': return handleFindMatch(ws, player);
      case 'cancel':     return handleCancel(ws, player);
      case 'move':       return handleMove(ws, player, msg);
      case 'resign':     return handleResign(ws, player);
      case 'ping':       return send(ws, { type: 'pong' });
    }
  });
  ws.on('close', () => { if(player) { removeFromQueue(ws); handleDisconnect(player); } });
  ws.on('error', () => {});
}

function handleAuth(ws, msg, setPlayer) {
  try {
    const decoded = jwt.verify(msg.token, JWT_SECRET);
    db.get('SELECT * FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if (err || !user) return send(ws, { type: 'error', message: 'User not found.' });
      const player = { ws, id: user.id, username: user.username, rating: user.rating, games: user.games };
      setPlayer(player);
      send(ws, { type: 'authed', user: safeUser(user) });
    });
  } catch { send(ws, { type: 'error', message: 'Invalid token.' }); }
}

function handleFindMatch(ws, player) {
  if (!player) return send(ws, { type: 'error', message: 'Not authenticated.' });
  if (waitingPlayers.find(p => p.id === player.id)) return;
  waitingPlayers.push(player);
  send(ws, { type: 'searching' });
  tryPair();
}

function tryPair() {
  if (waitingPlayers.length < 2) return;
  const p1 = waitingPlayers.shift();
  const p2 = waitingPlayers.shift();
  if (p1.ws.readyState !== 1 || p2.ws.readyState !== 1) {
    if (p1.ws.readyState === 1) waitingPlayers.unshift(p1);
    if (p2.ws.readyState === 1) waitingPlayers.unshift(p2);
    return;
  }
  startGame(p1, p2);
}

function handleCancel(ws, player) { if(player) removeFromQueue(ws); send(ws, { type: 'cancelled' }); }
function removeFromQueue(ws) { const i = waitingPlayers.findIndex(p => p.ws === ws); if(i !== -1) waitingPlayers.splice(i, 1); }

function startGame(white, black) {
  const gameId = uuidv4();
  const session = { id: gameId, white, black, moves: [], turn: 'white', startedAt: Date.now(), timer: null, timerVal: 10, over: false };
  activeGames.set(gameId, session);
  db.run("INSERT INTO games (id, white_id, black_id, white_rating, black_rating, moves) VALUES (?, ?, ?, ?, ?, '[]')",
    [gameId, white.id, black.id, white.rating, black.rating]);
  const info = { type: 'game_start', gameId, white: { username: white.username, rating: white.rating }, black: { username: black.username, rating: black.rating } };
  send(white.ws, Object.assign({}, info, { color: 'white' }));
  send(black.ws, Object.assign({}, info, { color: 'black' }));
  startTurnTimer(session, 'white');
}

function handleMove(ws, player, msg) {
  if (!player) return;
  const session = findGameByPlayer(player);
  if (!session || session.over) return;
  const color = session.white.id === player.id ? 'white' : 'black';
  if (session.turn !== color) return;
  const { from, to, san, evalBefore, evalAfter } = msg;
  const delta = (evalAfter || 0) - (evalBefore || 0);
  const THRESH = -2.0;
  const isBlunder = color === 'white' ? delta < THRESH : delta > -THRESH;
  session.moves.push({ color, from, to, san, evalBefore, evalAfter, delta });
  stopTurnTimer(session);
  broadcast(session, { type: 'move', color, from, to, san, evalBefore, evalAfter, delta, isBlunder });
  if (isBlunder) { endGame(session, color === 'white' ? 'black' : 'white', player.username + ' blundered - ' + san); return; }
  session.turn = color === 'white' ? 'black' : 'white';
  startTurnTimer(session, session.turn);
}

function startTurnTimer(session, color) {
  session.timerVal = 10;
  session.timer = setInterval(() => {
    session.timerVal--;
    broadcast(session, { type: 'timer', color, value: session.timerVal });
    if (session.timerVal <= 0) {
      stopTurnTimer(session);
      const p = color === 'white' ? session.white : session.black;
      endGame(session, color === 'white' ? 'black' : 'white', p.username + ' ran out of time');
    }
  }, 1000);
}

function stopTurnTimer(session) { if(session.timer) { clearInterval(session.timer); session.timer = null; } }
function handleResign(ws, player) { if(!player) return; const s = findGameByPlayer(player); if(!s||s.over) return; const c = s.white.id===player.id?'white':'black'; endGame(s, c==='white'?'black':'white', player.username+' resigned'); }
function handleDisconnect(player) { const s = findGameByPlayer(player); if(!s||s.over) return; const c = s.white.id===player.id?'white':'black'; endGame(s, c==='white'?'black':'white', player.username+' disconnected'); }

function endGame(session, winnerColor, reason) {
  if (session.over) return;
  session.over = true;
  stopTurnTimer(session);
  const winner = winnerColor === 'white' ? session.white : session.black;
  const loser  = winnerColor === 'white' ? session.black : session.white;
  db.get('SELECT * FROM users WHERE id = ?', [winner.id], (err, winnerUser) => {
    db.get('SELECT * FROM users WHERE id = ?', [loser.id], (err2, loserUser) => {
      if (!winnerUser || !loserUser) return;
      const elo = calculateElo(winnerUser.rating, loserUser.rating, winnerUser.games, loserUser.games);
      db.run('UPDATE users SET rating=?, peak_rating=MAX(peak_rating,?), wins=wins+1, games=games+1, no_ads=CASE WHEN MAX(peak_rating,?)>=1600 THEN 1 ELSE no_ads END WHERE id=?',
        [elo.winnerNew, elo.winnerNew, elo.winnerNew, winner.id]);
      db.run('UPDATE users SET rating=?, peak_rating=MAX(peak_rating,?), losses=losses+1, games=games+1 WHERE id=?',
        [elo.loserNew, elo.loserNew, loser.id]);
      const duration = Math.round((Date.now() - session.startedAt) / 1000);
      db.run("UPDATE games SET winner_id=?, end_reason=?, moves=?, white_delta=?, black_delta=?, duration_secs=?, ended_at=datetime('now') WHERE id=?",
        [winner.id, reason, JSON.stringify(session.moves),
         winnerColor==='white'?elo.winnerDelta:elo.loserDelta,
         winnerColor==='black'?elo.winnerDelta:elo.loserDelta,
         duration, session.id]);
      const result = {
        type: 'game_over', reason, winner: winnerColor, winnerUsername: winner.username,
        ratings: {
          white: { old: winnerColor==='white'?winnerUser.rating:loserUser.rating, new: winnerColor==='white'?elo.winnerNew:elo.loserNew, delta: winnerColor==='white'?elo.winnerDelta:elo.loserDelta },
          black: { old: winnerColor==='black'?winnerUser.rating:loserUser.rating, new: winnerColor==='black'?elo.winnerNew:elo.loserNew, delta: winnerColor==='black'?elo.winnerDelta:elo.loserDelta }
        },
        noAdsUnlocked: {
          white: elo.winnerNew>=1600&&winnerColor==='white'&&!winnerUser.no_ads,
          black: elo.winnerNew>=1600&&winnerColor==='black'&&!winnerUser.no_ads
        }
      };
      broadcast(session, result);
      activeGames.delete(session.id);
    });
  });
}

function broadcast(session, msg) { send(session.white.ws, msg); send(session.black.ws, msg); }
function send(ws, msg) { if(ws.readyState===1) ws.send(JSON.stringify(msg)); }
function findGameByPlayer(player) { for(const s of activeGames.values()) { if(s.white.id===player.id||s.black.id===player.id) return s; } return null; }
function safeUser(u) { return { id:u.id, username:u.username, rating:u.rating, peak_rating:u.peak_rating, wins:u.wins, losses:u.losses, games:u.games, no_ads:u.no_ads===1 }; }

module.exports = { handleConnection };
