/**
 * Sudden Death Chess — Matchmaker
 */
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../routes/auth');
const { calculateElo } = require('./elo');
const { BotPlayer } = require('./bot');

const queue = [];
const activeGames = new Map();
const BOT_WAIT_MS = 10000;
const BLUNDER_THRESH = -1.5;

function handleConnection(ws) {
  console.log('[WS] new connection');
  ws.player = null;
  ws.botTimer = null;

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    console.log('[MSG]', msg.type);
    switch (msg.type) {
      case 'auth':       return doAuth(ws, msg);
      case 'find_match': return doFindMatch(ws);
      case 'cancel':     return doCancel(ws);
      case 'move':       return doMove(ws, msg);
      case 'checkmate':  return doCheckmate(ws, msg);
      case 'blunder':    return doBlunder(ws, msg);
      case 'draw':       return doDraw(ws);
      case 'resign':     return doResign(ws);
      case 'ping':       return send(ws, { type: 'pong' });
    }
  });

  ws.on('close', () => {
    console.log('[CLOSE]', ws.player ? ws.player.username : 'unknown');
    removeFromQueue(ws);
    if (ws.botTimer) { clearTimeout(ws.botTimer); ws.botTimer = null; }
    const session = findSession(ws);
    if (session && !session.over) {
      const color = colorOf(session, ws);
      endGame(session, color === 'white' ? 'black' : 'white',
        (ws.player ? ws.player.username : 'Player') + ' disconnected');
    }
  });

  ws.on('error', () => {});
}

function doAuth(ws, msg) {
  try {
    const decoded = jwt.verify(msg.token, JWT_SECRET);
    db.get('SELECT * FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if (err || !user) return send(ws, { type: 'error', message: 'Auth failed.' });
      ws.player = {
        id: user.id, username: user.username,
        rating: user.rating, peak_rating: user.peak_rating,
        games: user.games, no_ads: user.no_ads
      };
      send(ws, { type: 'authed', user: safeUser(user) });
      console.log('[AUTH] authed:', user.username);
    });
  } catch (e) {
    console.log('[AUTH] error:', e.message);
    send(ws, { type: 'error', message: 'Bad token.' });
  }
}

function doFindMatch(ws) {
  if (!ws.player) return send(ws, { type: 'error', message: 'Not authenticated.' });
  if (queue.find(e => e.ws === ws)) return;
  queue.push({ ws, player: ws.player });
  send(ws, { type: 'searching' });
  console.log('[QUEUE] size:', queue.length);
  tryPair();
  if (queue.find(e => e.ws === ws)) {
    ws.botTimer = setTimeout(() => {
      if (queue.find(e => e.ws === ws)) {
        removeFromQueue(ws);
        startBotGame(ws);
      }
    }, BOT_WAIT_MS);
  }
}

function tryPair() {
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    if (a.ws.readyState !== 1) { if (b.ws.readyState === 1) queue.unshift(b); continue; }
    if (b.ws.readyState !== 1) { queue.unshift(a); continue; }
    if (a.ws.botTimer) { clearTimeout(a.ws.botTimer); a.ws.botTimer = null; }
    if (b.ws.botTimer) { clearTimeout(b.ws.botTimer); b.ws.botTimer = null; }
    startHumanGame(a.ws, a.player, b.ws, b.player);
  }
}

function doCancel(ws) {
  removeFromQueue(ws);
  if (ws.botTimer) { clearTimeout(ws.botTimer); ws.botTimer = null; }
  send(ws, { type: 'cancelled' });
}

function removeFromQueue(ws) {
  const i = queue.findIndex(e => e.ws === ws);
  if (i !== -1) queue.splice(i, 1);
}

function startHumanGame(wsW, white, wsB, black) {
  const id = uuidv4();
  const session = {
    id, isBot: false,
    whiteWs: wsW, blackWs: wsB,
    white, black,
    moves: [], turn: 'white',
    startedAt: Date.now(),
    timer: null, timerVal: 10, over: false
  };
  activeGames.set(id, session);
  db.run("INSERT INTO games (id,white_id,black_id,white_rating,black_rating,moves) VALUES (?,?,?,?,?,'[]')",
    [id, white.id, black.id, white.rating, black.rating]);
  const info = { type: 'game_start', gameId: id,
    white: { username: white.username, rating: white.rating },
    black: { username: black.username, rating: black.rating } };
  send(wsW, Object.assign({}, info, { color: 'white' }));
  send(wsB, Object.assign({}, info, { color: 'black' }));
  setTimeout(() => { if (!session.over) startTurnTimer(session, 'white'); }, 2000);
  console.log('[GAME] human:', white.username, 'vs', black.username);
}

function startBotGame(ws) {
  const human = ws.player;
  const id = uuidv4();
  const session = {
    id, isBot: true,
    whiteWs: ws, blackWs: null,
    white: human, black: null,
    moves: [], turn: 'white',
    startedAt: Date.now(),
    timer: null, timerVal: 10, over: false,
    bot: null
  };
  const bot = new BotPlayer(session, 'b', db);
  session.bot = bot;
  session.black = { id: -1, username: bot.name, rating: bot.rating };

  session.onBotMove = (data) => {
    if (session.over) return;
    session.moves.push({ color: 'black', from: data.from, to: data.to, san: data.san, delta: 0 });
    stopTurnTimer(session);
    send(ws, { type: 'move', color: 'black', from: data.from, to: data.to, san: data.san,
      evalBefore: 0, evalAfter: data.evalAfter || 0, delta: 0, isBlunder: false });
    session.turn = 'white';
    startTurnTimer(session, 'white');
  };

  activeGames.set(id, session);
  const info = { type: 'game_start', gameId: id,
    white: { username: human.username, rating: human.rating },
    black: { username: bot.name, rating: bot.rating },
    color: 'white' };
  send(ws, info);
  setTimeout(() => { if (!session.over) startTurnTimer(session, 'white'); }, 2000);
  console.log('[GAME] bot:', human.username, 'vs', bot.name);
}

function doMove(ws, msg) {
  const session = findSession(ws);
  if (!session || session.over) return;
  const color = colorOf(session, ws);
  if (!color || session.turn !== color) return;

  const { from, to, san, evalBefore, evalAfter } = msg;
  const delta = (evalAfter || 0) - (evalBefore || 0);
  const adjusted = color === 'white' ? delta : -delta;
  const isBlunder = adjusted < BLUNDER_THRESH;

  console.log('[MOVE]', ws.player.username, san, 'delta:', adjusted, 'blunder:', isBlunder);
  session.moves.push({ color, from, to, san, evalBefore, evalAfter, delta: adjusted });
  stopTurnTimer(session);

  if (session.isBot) {
    session.bot.onMove(from, to);
    send(ws, { type: 'move', color, from, to, san, evalBefore, evalAfter, delta: adjusted, isBlunder });
  } else {
    bcast(session, { type: 'move', color, from, to, san, evalBefore, evalAfter, delta: adjusted, isBlunder });
  }

  if (isBlunder) {
    endGame(session, color === 'white' ? 'black' : 'white', ws.player.username + ' blundered — ' + san);
    return;
  }

  const next = color === 'white' ? 'black' : 'white';
  session.turn = next;
  if (session.isBot && next === 'black') {
    session.bot.scheduleMove();
  } else {
    startTurnTimer(session, next);
  }
}

function startTurnTimer(session, color) {
  if (session.isBot && color === 'black') return;
  session.timerVal = 10;
  session.timer = setInterval(() => {
    session.timerVal--;
    if (session.isBot) {
      send(session.whiteWs, { type: 'timer', color, value: session.timerVal });
    } else {
      bcast(session, { type: 'timer', color, value: session.timerVal });
    }
    if (session.timerVal <= 0) {
      stopTurnTimer(session);
      const username = session.isBot
        ? session.white.username
        : (color === 'white' ? session.white.username : session.black.username);
      endGame(session, color === 'white' ? 'black' : 'white', username + ' ran out of time');
    }
  }, 1000);
}

function stopTurnTimer(session) {
  if (session.timer) { clearInterval(session.timer); session.timer = null; }
}


function doBlunder(ws, msg) {
  const session = findSession(ws);
  if (!session || session.over) return;
  const color = colorOf(session, ws);
  if (!color) return;
  console.log('[BLUNDER]', ws.player.username, 'lost', msg.worstLoss, 'on', msg.san);
  endGame(session, color === 'white' ? 'black' : 'white',
    ws.player.username + ' blundered — ' + msg.san);
}

function doCheckmate(ws, msg) {
  const session = findSession(ws);
  if (!session || session.over) return;
  const winner = msg.winner || colorOf(session, ws);
  console.log('[CHECKMATE]', ws.player.username, 'wins');
  endGame(session, winner, ws.player.username + ' wins by checkmate!');
}

function doDraw(ws) {
  const session = findSession(ws);
  if (!session || session.over) return;
  console.log('[DRAW] stalemate or insufficient material');
  endGame(session, 'draw', 'Game drawn');
}

function doResign(ws) {
  const session = findSession(ws);
  if (!session || session.over) return;
  const color = colorOf(session, ws);
  endGame(session, color === 'white' ? 'black' : 'white', ws.player.username + ' resigned');
}

function endGame(session, winnerColor, reason) {
  if (session.over) return;
  session.over = true;
  stopTurnTimer(session);
  if (session.bot) session.bot.stop();
  console.log('[END]', reason, 'winner:', winnerColor);

  if (session.isBot) {
    const human = session.white;
    const humanWon = winnerColor === 'white';
    const delta = humanWon ? 15 : -12;
    const newRating = Math.max(100, human.rating + delta);
    db.run('UPDATE users SET rating=?, peak_rating=MAX(peak_rating,?), wins=wins+?, losses=losses+?, games=games+1, no_ads=CASE WHEN MAX(peak_rating,?)>=1600 THEN 1 ELSE no_ads END WHERE id=?',
      [newRating, newRating, humanWon ? 1 : 0, humanWon ? 0 : 1, newRating, human.id]);
    const result = {
      type: 'game_over', reason,
      winner: winnerColor,
      winnerUsername: humanWon ? human.username : session.bot.name,
      ratings: {
        white: { old: human.rating, new: newRating, delta },
        black: { old: session.bot.rating, new: session.bot.rating, delta: 0 }
      },
      noAdsUnlocked: { white: newRating >= 1600 && !human.no_ads, black: false }
    };
    send(session.whiteWs, result);
    activeGames.delete(session.id);
    return;
  }

  const winner = winnerColor === 'white' ? session.white : session.black;
  const loser  = winnerColor === 'white' ? session.black : session.white;
  db.get('SELECT * FROM users WHERE id=?', [winner.id], (e1, wu) => {
    db.get('SELECT * FROM users WHERE id=?', [loser.id], (e2, lu) => {
      if (!wu || !lu) return;
      const elo = calculateElo(wu.rating, lu.rating, wu.games, lu.games);
      db.run('UPDATE users SET rating=?, peak_rating=MAX(peak_rating,?), wins=wins+1, games=games+1, no_ads=CASE WHEN MAX(peak_rating,?)>=1600 THEN 1 ELSE no_ads END WHERE id=?',
        [elo.winnerNew, elo.winnerNew, elo.winnerNew, winner.id]);
      db.run('UPDATE users SET rating=?, peak_rating=MAX(peak_rating,?), losses=losses+1, games=games+1 WHERE id=?',
        [elo.loserNew, elo.loserNew, loser.id]);
      const dur = Math.round((Date.now() - session.startedAt) / 1000);
      db.run("UPDATE games SET winner_id=?, end_reason=?, moves=?, white_delta=?, black_delta=?, duration_secs=?, ended_at=datetime('now') WHERE id=?",
        [winner.id, reason, JSON.stringify(session.moves),
         winnerColor==='white'?elo.winnerDelta:elo.loserDelta,
         winnerColor==='black'?elo.winnerDelta:elo.loserDelta,
         dur, session.id]);
      const result = {
        type: 'game_over', reason,
        winner: winnerColor, winnerUsername: winner.username,
        ratings: {
          white: { old: winnerColor==='white'?wu.rating:lu.rating,
                   new: winnerColor==='white'?elo.winnerNew:elo.loserNew,
                   delta: winnerColor==='white'?elo.winnerDelta:elo.loserDelta },
          black: { old: winnerColor==='black'?wu.rating:lu.rating,
                   new: winnerColor==='black'?elo.winnerNew:elo.loserNew,
                   delta: winnerColor==='black'?elo.winnerDelta:elo.loserDelta }
        },
        noAdsUnlocked: {
          white: elo.winnerNew>=1600 && winnerColor==='white' && !wu.no_ads,
          black: elo.winnerNew>=1600 && winnerColor==='black' && !wu.no_ads
        }
      };
      bcast(session, result);
      activeGames.delete(session.id);
    });
  });
}

function bcast(session, msg) { send(session.whiteWs, msg); send(session.blackWs, msg); }
function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function colorOf(session, ws) {
  if (session.whiteWs === ws) return 'white';
  if (session.blackWs === ws) return 'black';
  return null;
}
function findSession(ws) {
  for (const s of activeGames.values()) {
    if (s.whiteWs === ws || s.blackWs === ws) return s;
  }
  return null;
}
function safeUser(u) {
  return { id: u.id, username: u.username, rating: u.rating, peak_rating: u.peak_rating,
           wins: u.wins, losses: u.losses, games: u.games, no_ads: u.no_ads === 1 };
}

module.exports = { handleConnection };
