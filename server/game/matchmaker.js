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
const challenges = new Map();   // code -> { ws, player } for Play-a-Friend invites
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
      case 'opp_blunder': return doOppBlunder(ws, msg);
      case 'draw':       return doDraw(ws);
      case 'resign':     return doResign(ws);
      case 'ping':       return send(ws, { type: 'pong' });
      case 'ready':      return doReady(ws);
      case 'committed':  return doCommitted(ws);
      case 'guest':      return doGuestAuth(ws);
      case 'create_challenge': return doCreateChallenge(ws);
      case 'join_challenge':   return doJoinChallenge(ws, msg);
      case 'cancel_challenge': return doCancelChallenge(ws);
    }
  });

  ws.on('close', () => {
    console.log('[CLOSE]', ws.player ? ws.player.username : 'unknown');
    removeFromQueue(ws);
    if (ws.botTimer) { clearTimeout(ws.botTimer); ws.botTimer = null; }
    if (ws.challengeCode) { challenges.delete(ws.challengeCode); ws.challengeCode = null; }
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

let guestSeq = 0;
function guestName() { return 'guest' + Math.floor(1000000000 + Math.random() * 9000000000); }
function doGuestAuth(ws) {
  guestSeq++;
  const name = guestName();
  ws.player = {
    id: -100 - guestSeq,          // negative sentinel: never collides with a real users row
    username: name,
    rating: 1000, peak_rating: 1000,
    games: 0, no_ads: 0, guest: true
  };
  send(ws, { type: 'authed', user: {
    id: ws.player.id, username: name, rating: 1000, peak_rating: 1000,
    wins: 0, losses: 0, games: 0, no_ads: false, guest: true
  }});
  console.log('[GUEST] joined:', name);
}

function doFindMatch(ws) {
  if (!ws.player) return send(ws, { type: 'error', message: 'Not authenticated.' });
  if (ws.player.guest) {                                 // guests never wait in the real queue,
    send(ws, { type: 'searching' });                     // but still see a brief "searching" beat
    if (ws.botTimer) clearTimeout(ws.botTimer);
    ws.botTimer = setTimeout(() => { if (ws.readyState === 1) startBotGame(ws); }, 2200 + Math.random() * 2200);
    return;
  }
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

// ── PLAY A FRIEND (private challenge links) ──────────────────────────────
function makeChallengeCode() {
  let code;
  do { code = Math.random().toString(36).slice(2, 8); } while (challenges.has(code));
  return code;
}
function doCreateChallenge(ws) {
  if (!ws.player) return send(ws, { type: 'error', message: 'Not authenticated.' });
  if (ws.challengeCode) challenges.delete(ws.challengeCode);   // one active invite per connection
  const code = makeChallengeCode();
  challenges.set(code, { ws, player: ws.player });
  ws.challengeCode = code;
  send(ws, { type: 'challenge_created', code });
  console.log('[CHALLENGE] created', code, 'by', ws.player.username);
  setTimeout(() => { const e = challenges.get(code); if (e && e.ws === ws) challenges.delete(code); }, 600000); // 10 min expiry
}
function doJoinChallenge(ws, msg) {
  if (!ws.player) return send(ws, { type: 'error', message: 'Not authenticated.' });
  const code = String(msg.code || '').toLowerCase();
  const entry = challenges.get(code);
  if (!entry || entry.ws.readyState !== 1 || entry.ws === ws) {
    return send(ws, { type: 'challenge_invalid' });
  }
  challenges.delete(code);
  entry.ws.challengeCode = null;
  console.log('[CHALLENGE] joined', code, ':', entry.player.username, 'vs', ws.player.username);
  startHumanGame(entry.ws, entry.player, ws, ws.player);   // creator plays white
}
function doCancelChallenge(ws) {
  if (ws.challengeCode) { challenges.delete(ws.challengeCode); ws.challengeCode = null; }
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
    timer: null, timerVal: 5, over: false
  };
  activeGames.set(id, session);
  db.run("INSERT INTO games (id,white_id,black_id,white_name,black_name,white_rating,black_rating,moves) VALUES (?,?,?,?,?,?,?,'[]')",
    [id, white.id, black.id, white.username, black.username, white.rating, black.rating]);
  const info = { type: 'game_start', gameId: id,
    white: { username: white.username, rating: white.rating },
    black: { username: black.username, rating: black.rating } };
  send(wsW, Object.assign({}, info, { color: 'white' }));
  send(wsB, Object.assign({}, info, { color: 'black' }));
  setTimeout(() => { if (!session.over && !session.timer && session.moves.length === 0) startTurnTimer(session, 'white'); }, 6000);
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
    timer: null, timerVal: 5, over: false,
    bot: null
  };
  const bot = new BotPlayer(session, 'b', human.rating);
  if (human.guest) bot.name = guestName();   // guests face an anonymous "guest" opponent, not a named bot
  session.bot = bot;
  session.black = { id: -1, username: bot.name, rating: bot.rating };

  session.onBotMove = (data) => {
    if (session.over) return;
    session.moves.push({ color: 'black', from: data.from, to: data.to, san: data.san, delta: 0 });
    stopTurnTimer(session);
    send(ws, { type: 'move', color: 'black', from: data.from, to: data.to, san: data.san,
      evalBefore: 0, evalAfter: data.evalAfter || 0, delta: 0, isBlunder: false });
    session.turn = 'white';
    armReadyFallback(session, 'white');     // human's clock starts when their client signals 'ready' (after judging the bot's move)
  };

  activeGames.set(id, session);
  db.run("INSERT INTO games (id,white_id,black_id,white_name,black_name,white_rating,black_rating,moves) VALUES (?,?,?,?,?,?,?,'[]')",
    [id, human.id, -1, human.username, bot.name, human.rating, bot.rating]);
  const info = { type: 'game_start', gameId: id,
    white: { username: human.username, rating: human.rating },
    black: { username: bot.name, rating: bot.rating },
    color: 'white' };
  send(ws, info);
  setTimeout(() => { if (!session.over && !session.timer && session.moves.length === 0) startTurnTimer(session, 'white'); }, 6000);
  console.log('[GAME] bot:', human.username, 'vs', bot.name);
}

function doReady(ws) {
  const session = findSession(ws);
  if (!session || session.over) return;
  const color = colorOf(session, ws);
  if (!color || session.turn !== color) return;  // only the side to move starts its own clock
  if (session.timer) return;                     // already running
  startTurnTimer(session, color);
}

function doCommitted(ws) {
  const session = findSession(ws);
  if (!session || session.over) return;
  const color = colorOf(session, ws);
  if (!color || session.turn !== color) return;   // only the side to move can commit
  stopTurnTimer(session);                          // freeze the clock during the client's eval
}

function doMove(ws, msg) {
  const session = findSession(ws);
  if (!session || session.over) return;
  const color = colorOf(session, ws);
  if (!color || session.turn !== color) return;

  const { from, to, san, evalBefore, evalAfter } = msg;
  const delta = (evalAfter || 0) - (evalBefore || 0);
  const adjusted = color === 'white' ? delta : -delta;

  console.log('[MOVE]', ws.player.username, san, 'delta:', adjusted);
  session.moves.push({ color, from, to, san, evalBefore, evalAfter, delta: adjusted });
  stopTurnTimer(session);

  // NOTE: blunder detection is now CLIENT-side (tempo-corrected). The server no
  // longer second-guesses it here — the client sends an explicit 'blunder' /
  // 'opp_blunder' message when it decides. This keeps both sides in agreement.
  if (session.isBot) {
    session.bot.onMove(from, to);
    send(ws, { type: 'move', color, from, to, san, evalBefore, evalAfter, delta: adjusted, isBlunder: false });
  } else {
    bcast(session, { type: 'move', color, from, to, san, evalBefore, evalAfter, delta: adjusted, isBlunder: false });
  }

  const next = color === 'white' ? 'black' : 'white';
  session.turn = next;
  if (session.isBot && next === 'black') {
    session.bot.scheduleMove();
    startTurnTimer(session, next);          // bot has no eval delay -- start its display clock now
  } else {
    armReadyFallback(session, next);        // human: their client starts the clock via 'ready' after judging the opponent's move
  }
}

function armReadyFallback(session, color) {
  // Safety net: if the client's 'ready' is lost, start the clock anyway after a
  // grace period (longer than the ~1.5-2s client eval) so a turn can't hang.
  setTimeout(() => {
    if (!session.over && !session.timer && session.turn === color) startTurnTimer(session, color);
  }, 3500);
}

function startTurnTimer(session, color) {
  session.timerVal = 5;
  session.timer = setInterval(() => {
    session.timerVal--;
    if (session.isBot) {
      send(session.whiteWs, { type: 'timer', color, value: session.timerVal });
    } else {
      bcast(session, { type: 'timer', color, value: session.timerVal });
    }
    if (session.timerVal <= 0) {
      stopTurnTimer(session);
      if (session.isBot && color === 'black') return;   // bot's display clock -- it still moves; never forfeit it
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
  session.blunderDetail = msg.detail || null;
  endGame(session, color === 'white' ? 'black' : 'white',
    ws.player.username + ' blundered — ' + msg.san);
}

function doOppBlunder(ws, msg) {
  const session = findSession(ws);
  if (!session || session.over) return;
  const color = colorOf(session, ws);
  if (!color) return;
  // The REPORTING player wins — their opponent blundered.
  console.log('[OPP_BLUNDER]', ws.player.username, 'wins, opp blundered on', msg.san);
  endGame(session, color, 'Opponent blundered — ' + msg.san);
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
    // Read the CURRENT rating from the DB — not the stale snapshot captured at
    // connect time — so consecutive games don't overwrite each other.
    db.get('SELECT rating, peak_rating, no_ads, games FROM users WHERE id=?', [human.id], (err, row) => {
      const curRating = (row && typeof row.rating === 'number') ? row.rating : human.rating;
      const curPeak   = (row && typeof row.peak_rating === 'number') ? row.peak_rating : curRating;
      const curNoAds  = row ? row.no_ads : human.no_ads;
      const curGames  = (row && typeof row.games === 'number') ? row.games : (human.games || 0);
      const botRating = session.bot.rating;
      const _elo = humanWon
        ? calculateElo(curRating, botRating, curGames, 30)
        : calculateElo(botRating, curRating, 30, curGames);
      const delta = humanWon ? _elo.winnerDelta : _elo.loserDelta;
      const newRating = Math.max(100, curRating + delta);
      db.run('UPDATE users SET rating=?, peak_rating=MAX(peak_rating,?), wins=wins+?, losses=losses+?, games=games+1 WHERE id=?',
        [newRating, newRating, humanWon ? 1 : 0, humanWon ? 0 : 1, human.id]);
      // Keep the in-memory player fresh for the NEXT game on this connection.
      human.rating = newRating;
      human.peak_rating = Math.max(curPeak, newRating);
      const dur = Math.round((Date.now() - session.startedAt) / 1000);
      db.run("UPDATE games SET winner_id=?, end_reason=?, moves=?, white_delta=?, black_delta=0, duration_secs=?, ended_at=datetime('now') WHERE id=?",
        [humanWon ? human.id : -1, reason, JSON.stringify(session.moves), delta, dur, session.id]);
      const result = {
        type: 'game_over', reason,
        winner: winnerColor,
        winnerUsername: humanWon ? human.username : session.bot.name,
        blunderDetail: session.blunderDetail || null,
        ratings: {
          white: { old: curRating, new: newRating, delta },
          black: { old: session.bot.rating, new: session.bot.rating, delta: 0 }
        },
        noAdsUnlocked: { white: false, black: false }
      };
      send(session.whiteWs, result);
    });
    activeGames.delete(session.id);
    return;
  }

  const winner = winnerColor === 'white' ? session.white : session.black;
  const loser  = winnerColor === 'white' ? session.black : session.white;
  db.get('SELECT * FROM users WHERE id=?', [winner.id], (e1, wu) => {
    db.get('SELECT * FROM users WHERE id=?', [loser.id], (e2, lu) => {
      if (!wu || !lu) {
        // A guest is involved (no DB row) — resolve casually, no rating changes.
        bcast(session, {
          type: 'game_over', reason, winner: winnerColor, winnerUsername: winner.username,
          blunderDetail: session.blunderDetail || null,
          ratings: {
            white: { old: session.white.rating, new: session.white.rating, delta: 0 },
            black: { old: session.black.rating, new: session.black.rating, delta: 0 }
          },
          noAdsUnlocked: { white: false, black: false }
        });
        activeGames.delete(session.id);
        return;
      }
      const elo = calculateElo(wu.rating, lu.rating, wu.games, lu.games);
      db.run('UPDATE users SET rating=?, peak_rating=MAX(peak_rating,?), wins=wins+1, games=games+1 WHERE id=?',
        [elo.winnerNew, elo.winnerNew, winner.id]);
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
        blunderDetail: session.blunderDetail || null,
        ratings: {
          white: { old: winnerColor==='white'?wu.rating:lu.rating,
                   new: winnerColor==='white'?elo.winnerNew:elo.loserNew,
                   delta: winnerColor==='white'?elo.winnerDelta:elo.loserDelta },
          black: { old: winnerColor==='black'?wu.rating:lu.rating,
                   new: winnerColor==='black'?elo.winnerNew:elo.loserNew,
                   delta: winnerColor==='black'?elo.winnerDelta:elo.loserDelta }
        },
        noAdsUnlocked: { white: false, black: false }
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
           wins: u.wins, losses: u.losses, games: u.games, no_ads: u.no_ads === 1, is_premium: u.is_premium === 1 };
}

module.exports = { handleConnection };
