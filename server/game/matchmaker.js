const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../routes/auth');
const { calculateElo } = require('./elo');
const { BotPlayer, BOT_NAMES } = require('./bot');

const waitingPlayers = [];
const activeGames = new Map();

const BOT_WAIT_TIME = 10000; // Wait 10 seconds before assigning a bot

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
  console.log("[AUTH] received auth message");
  try {
    const decoded = jwt.verify(msg.token, JWT_SECRET);
    db.get('SELECT * FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if (err || !user) return send(ws, { type: 'error', message: 'User not found.' });
      const player = { ws, id: user.id, username: user.username, rating: user.rating, games: user.games, botTimer: null };
      setPlayer(player);
      send(ws, { type: 'authed', user: safeUser(user) });
    });
  } catch { send(ws, { type: 'error', message: 'Invalid token.' }); }
}

function handleFindMatch(ws, player) {
  console.log("[FIND] find_match received, player:", player ? player.username : "NULL");
  if (!player) return send(ws, { type: 'error', message: 'Not authenticated.' });
  if (waitingPlayers.find(p => p.id === player.id)) return;
  waitingPlayers.push(player);
  send(ws, { type: 'searching' });
  tryPair();

  // If no match found in BOT_WAIT_TIME, assign a bot
  player.botTimer = setTimeout(() => {
    console.log("[BOT TIMER] fired, checking if still waiting...");
    const stillWaiting = waitingPlayers.find(p => p.id === player.id);
    if (stillWaiting) {
      removeFromQueue(ws);
      startGameWithBot(player);
    }
  }, BOT_WAIT_TIME);
}

function tryPair() {
  if (waitingPlayers.length < 2) return;
  const p1 = waitingPlayers.shift();
  const p2 = waitingPlayers.shift();
  // Cancel bot timers since they found a real match
  if (p1.botTimer) { clearTimeout(p1.botTimer); p1.botTimer = null; }
  if (p2.botTimer) { clearTimeout(p2.botTimer); p2.botTimer = null; }
  if (p1.ws.readyState !== 1 || p2.ws.readyState !== 1) {
    if (p1.ws.readyState === 1) waitingPlayers.unshift(p1);
    if (p2.ws.readyState === 1) waitingPlayers.unshift(p2);
    return;
  }
  startGame(p1, p2);
}

function handleCancel(ws, player) {
  if (player) {
    if (player.botTimer) { clearTimeout(player.botTimer); player.botTimer = null; }
    removeFromQueue(ws);
  }
  send(ws, { type: 'cancelled' });
}

function removeFromQueue(ws) {
  const i = waitingPlayers.findIndex(p => p.ws === ws);
  if(i !== -1) waitingPlayers.splice(i, 1);
}

// ── Real game ──
function startGame(white, black) {
  const gameId = uuidv4();
  const session = {
    id: gameId, white, black, moves: [],
    turn: 'white', startedAt: Date.now(),
    timer: null, timerVal: 10, over: false,
    bot: null,
  };
  activeGames.set(gameId, session);
  db.run("INSERT INTO games (id, white_id, black_id, white_rating, black_rating, moves) VALUES (?, ?, ?, ?, ?, '[]')",
    [gameId, white.id, black.id, white.rating, black.rating]);
  const info = { type: 'game_start', gameId,
    white: { username: white.username, rating: white.rating },
    black: { username: black.username, rating: black.rating }
  };
  send(white.ws, Object.assign({}, info, { color: 'white' }));
  send(black.ws, Object.assign({}, info, { color: 'black' }));
  startTurnTimer(session, 'white');
}

// ── Bot game ──
function startGameWithBot(human) {
  console.log("[BOT] starting bot game for:", human.username);
  const gameId = uuidv4();
  const humanColor = Math.random() < 0.5 ? 'white' : 'black';
  const botColor   = humanColor === 'white' ? 'black' : 'white';

  const session = {
    id: gameId,
    white: humanColor==='white' ? human : null,
    black: humanColor==='black' ? human : null,
    moves: [], turn: 'white',
    startedAt: Date.now(),
    timer: null, timerVal: 10, over: false,
    bot: null,
    humanColor, botColor,
    humanWs: human.ws,
  };

  const bot = new BotPlayer(session, botColor, db);
  session.bot = bot;

  // Wire up bot move handler
  session.onBotMove = (moveData) => {
    if (session.over) return;
    const { from, to, san, evalBefore, evalAfter } = moveData;
    const delta = evalAfter - evalBefore;
    session.moves.push({ color: botColor, from, to, san, evalBefore, evalAfter, delta });
    stopTurnTimer(session);

    // Send move to human
    send(human.ws, { type: 'move', color: botColor, from, to, san, evalBefore, evalAfter, delta, isBlunder: false });

    session.turn = humanColor;
    startTurnTimer(session, humanColor);
  };

  activeGames.set(gameId, session);

  const botRating = bot.rating;
  const info = {
    type: 'game_start', gameId,
    white: humanColor==='white'
      ? { username: human.username, rating: human.rating }
      : { username: bot.name, rating: botRating },
    black: humanColor==='black'
      ? { username: human.username, rating: human.rating }
      : { username: bot.name, rating: botRating },
  };
  send(human.ws, Object.assign({}, info, { color: humanColor }));

  startTurnTimer(session, 'white');

  // If bot goes first (human is black), schedule bot move
  if (botColor === 'white') {
    setTimeout(() => bot.scheduleMove(), 500);
  }
}

// ── Move handling ──
function handleMove(ws, player, msg) {
  if (!player) return;
  const session = findGameByPlayer(player);
  if (!session || session.over) return;
  const color = getPlayerColor(session, player);
  if (!color || session.turn !== color) return;

  const { from, to, san, evalBefore, evalAfter } = msg;
  const delta = (evalAfter||0) - (evalBefore||0);
  const THRESH = -2.0;
  const isBlunder = delta < THRESH;

  session.moves.push({ color, from, to, san, evalBefore, evalAfter, delta });
  stopTurnTimer(session);

  // Tell opponent (human or bot)
  if (session.bot && color === session.humanColor) {
    // Update bot's board
    session.bot.onMove(from, to);
    // Broadcast to human
    send(ws, { type: 'move', color, from, to, san, evalBefore, evalAfter, delta, isBlunder });
  } else {
    broadcast(session, { type: 'move', color, from, to, san, evalBefore, evalAfter, delta, isBlunder });
  }

  if (isBlunder) {
    const winnerColor = color === 'white' ? 'black' : 'white';
    endGame(session, winnerColor, `${player.username} blundered — ${san}`);
    return;
  }

  const nextTurn = color === 'white' ? 'black' : 'white';
  session.turn = nextTurn;

  if (session.bot && nextTurn === session.botColor) {
    // Bot's turn
    session.bot.scheduleMove();
  } else {
    startTurnTimer(session, nextTurn);
  }
}

function getPlayerColor(session, player) {
  if (session.white && session.white.id === player.id) return 'white';
  if (session.black && session.black.id === player.id) return 'black';
  if (session.humanColor) return session.humanColor;
  return null;
}

function startTurnTimer(session, color) {
  // Only run timer for human's turn (bot has its own delay)
  if (session.bot && color === session.botColor) return;
  session.timerVal = 10;
  session.timer = setInterval(() => {
    session.timerVal--;
    const humanWs = session.humanWs || (session.white ? session.white.ws : null) || (session.black ? session.black.ws : null);
    if (humanWs) send(humanWs, { type: 'timer', color, value: session.timerVal });
    if (session.timerVal <= 0) {
      stopTurnTimer(session);
      const winnerColor = color === 'white' ? 'black' : 'white';
      const p = session.humanColor ? { username: 'You' } : (color==='white'?session.white:session.black);
      endGame(session, winnerColor, `${p.username} ran out of time`);
    }
  }, 1000);
}

function stopTurnTimer(session) {
  if(session.timer) { clearInterval(session.timer); session.timer = null; }
}

function handleResign(ws, player) {
  if(!player) return;
  const s = findGameByPlayer(player);
  if(!s||s.over) return;
  const c = getPlayerColor(s, player);
  endGame(s, c==='white'?'black':'white', `${player.username} resigned`);
}

function handleDisconnect(player) {
  const s = findGameByPlayer(player);
  if(!s||s.over) return;
  const c = getPlayerColor(s, player);
  endGame(s, c==='white'?'black':'white', `${player.username} disconnected`);
}

function endGame(session, winnerColor, reason) {
  if (session.over) return;
  session.over = true;
  stopTurnTimer(session);
  if (session.bot) session.bot.stop();

  // For bot games, only update the human's rating
  if (session.bot) {
    const human = session.white || session.black;
    const humanWon = winnerColor === session.humanColor;
    const rDelta = humanWon ? 15 : -12;
    const newRating = Math.max(100, human.rating + rDelta);

    db.run('UPDATE users SET rating=?, peak_rating=MAX(peak_rating,?), wins=wins+?, losses=losses+?, games=games+1, no_ads=CASE WHEN MAX(peak_rating,?)>=1600 THEN 1 ELSE no_ads END WHERE id=?',
      [newRating, newRating, humanWon?1:0, humanWon?0:1, newRating, human.id]);

    const result = {
      type: 'game_over', reason,
      winner: winnerColor,
      winnerUsername: humanWon ? human.username : session.bot.name,
      ratings: {
        [session.humanColor]: { old: human.rating, new: newRating, delta: rDelta },
        [session.botColor]:   { old: session.bot.rating, new: session.bot.rating, delta: 0 },
      },
      noAdsUnlocked: { [session.humanColor]: newRating>=1600&&!human.no_ads, [session.botColor]: false }
    };
    send(human.ws, result);
    activeGames.delete(session.id);
    return;
  }

  // Real game
  const winner = winnerColor==='white' ? session.white : session.black;
  const loser  = winnerColor==='white' ? session.black : session.white;
  db.get('SELECT * FROM users WHERE id = ?', [winner.id], (err, winnerUser) => {
    db.get('SELECT * FROM users WHERE id = ?', [loser.id], (err2, loserUser) => {
      if (!winnerUser || !loserUser) return;
      const elo = calculateElo(winnerUser.rating, loserUser.rating, winnerUser.games, loserUser.games);
      db.run('UPDATE users SET rating=?, peak_rating=MAX(peak_rating,?), wins=wins+1, games=games+1, no_ads=CASE WHEN MAX(peak_rating,?)>=1600 THEN 1 ELSE no_ads END WHERE id=?',
        [elo.winnerNew, elo.winnerNew, elo.winnerNew, winner.id]);
      db.run('UPDATE users SET rating=?, peak_rating=MAX(peak_rating,?), losses=losses+1, games=games+1 WHERE id=?',
        [elo.loserNew, elo.loserNew, loser.id]);
      const duration = Math.round((Date.now()-session.startedAt)/1000);
      db.run("UPDATE games SET winner_id=?, end_reason=?, moves=?, white_delta=?, black_delta=?, duration_secs=?, ended_at=datetime('now') WHERE id=?",
        [winner.id, reason, JSON.stringify(session.moves),
         winnerColor==='white'?elo.winnerDelta:elo.loserDelta,
         winnerColor==='black'?elo.winnerDelta:elo.loserDelta,
         duration, session.id]);
      const result = {
        type: 'game_over', reason, winner: winnerColor, winnerUsername: winner.username,
        ratings: {
          white: { old: winnerColor==='white'?winnerUser.rating:loserUser.rating, new: winnerColor==='white'?elo.winnerNew:elo.loserNew, delta: winnerColor==='white'?elo.winnerDelta:elo.loserDelta },
          black: { old: winnerColor==='black'?winnerUser.rating:loserUser.rating, new: winnerColor==='black'?elo.winnerNew:elo.loserNew, delta: winnerColor==='black'?elo.winnerDelta:elo.loserDelta },
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

function broadcast(session, msg) {
  if (session.white) send(session.white.ws, msg);
  if (session.black) send(session.black.ws, msg);
}
function send(ws, msg) { if(ws&&ws.readyState===1) ws.send(JSON.stringify(msg)); }
function findGameByPlayer(player) { for(const s of activeGames.values()) { if((s.white&&s.white.id===player.id)||(s.black&&s.black.id===player.id)) return s; } return null; }
function safeUser(u) { return { id:u.id, username:u.username, rating:u.rating, peak_rating:u.peak_rating, wins:u.wins, losses:u.losses, games:u.games, no_ads:u.no_ads===1 }; }

module.exports = { handleConnection };
