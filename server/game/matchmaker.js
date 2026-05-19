const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../routes/auth');
const { calculateElo } = require('./elo');
const { BotPlayer } = require('./bot');

const queue = new Map(); // ws -> player
const games = new Map(); // gameId -> session
const BOT_DELAY = 10000;

function handleConnection(ws) {
  console.log('[WS] new connection');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    console.log('[MSG]', msg.type);

    if (msg.type === 'auth') {
      try {
        const decoded = jwt.verify(msg.token, JWT_SECRET);
        db.get('SELECT * FROM users WHERE id = ?', [decoded.id], (err, user) => {
          if (err || !user) { ws.player = null; send(ws, { type: 'error', message: 'Auth failed' }); return; }
          ws.player = { ws, id: user.id, username: user.username, rating: user.rating, games: user.games };
          send(ws, { type: 'authed', user: safeUser(user) });
          console.log('[AUTH] authed:', user.username);
        });
      } catch(e) { console.log('[AUTH] error:', e.message); send(ws, { type: 'error', message: 'Bad token' }); }
      return;
    }

    if (msg.type === 'find_match') {
      const player = ws.player;
      console.log('[FIND] player:', player ? player.username : 'null');
      if (!player) { send(ws, { type: 'error', message: 'Not authenticated' }); return; }

      // Already in queue?
      if (queue.has(ws)) return;
      queue.set(ws, player);
      send(ws, { type: 'searching' });
      console.log('[QUEUE] size:', queue.size);

      // Try to pair with someone
      if (queue.size >= 2) {
        const entries = [...queue.entries()];
        const [ws1, p1] = entries[0];
        const [ws2, p2] = entries[1];
        if (ws1 !== ws2 && ws1.readyState === 1 && ws2.readyState === 1) {
          queue.delete(ws1); queue.delete(ws2);
          if (ws1.botTimer) { clearTimeout(ws1.botTimer); ws1.botTimer = null; }
          if (ws2.botTimer) { clearTimeout(ws2.botTimer); ws2.botTimer = null; }
          startGame(p1, p2);
          return;
        }
      }

      // Set bot timer
      ws.botTimer = setTimeout(() => {
        if (queue.has(ws)) {
          queue.delete(ws);
          console.log('[BOT] assigning bot to', player.username);
          startBotGame(player);
        }
      }, BOT_DELAY);
      return;
    }

    if (msg.type === 'cancel') {
      queue.delete(ws);
      if (ws.botTimer) { clearTimeout(ws.botTimer); ws.botTimer = null; }
      send(ws, { type: 'cancelled' });
      return;
    }

    if (msg.type === 'move') {
      const session = findSession(ws);
      if (!session || session.over) return;
      const color = getColor(session, ws);
      if (!color || session.turn !== color) return;
      processMove(session, ws, color, msg);
      return;
    }

    if (msg.type === 'resign') {
      const session = findSession(ws);
      if (!session || session.over) return;
      const color = getColor(session, ws);
      endGame(session, color === 'white' ? 'black' : 'white', ws.player.username + ' resigned');
      return;
    }

    if (msg.type === 'ping') { send(ws, { type: 'pong' }); return; }
  });

  ws.on('close', () => {
    console.log('[CLOSE]', ws.player ? ws.player.username : 'unknown');
    queue.delete(ws);
    if (ws.botTimer) { clearTimeout(ws.botTimer); ws.botTimer = null; }
    const session = findSession(ws);
    if (session && !session.over) {
      const color = getColor(session, ws);
      endGame(session, color === 'white' ? 'black' : 'white', (ws.player ? ws.player.username : 'Player') + ' disconnected');
    }
  });

  ws.on('error', () => {});
}

function startGame(white, black) {
  const id = uuidv4();
  const session = { id, whiteWs: white.ws, blackWs: black.ws, white, black, moves: [], turn: 'white', startedAt: Date.now(), timer: null, timerVal: 10, over: false, bot: null };
  games.set(id, session);
  db.run("INSERT INTO games (id,white_id,black_id,white_rating,black_rating,moves) VALUES (?,?,?,?,?,'[]')", [id, white.id, black.id, white.rating, black.rating]);
  const info = { type: 'game_start', gameId: id, white: { username: white.username, rating: white.rating }, black: { username: black.username, rating: black.rating } };
  send(white.ws, { ...info, color: 'white' });
  send(black.ws, { ...info, color: 'black' });
  startTimer(session, 'white');
  console.log('[GAME] started:', white.username, 'vs', black.username);
}

function startBotGame(human) {
  const id = uuidv4();
  const humanColor = 'white';
  const botColor = 'black';
  const session = { id, whiteWs: human.ws, blackWs: null, white: human, black: null, moves: [], turn: 'white', startedAt: Date.now(), timer: null, timerVal: 10, over: false, bot: null, humanColor, botColor };
  const bot = new BotPlayer(session, botColor, db);
  session.bot = bot;
  session.blackWs = { readyState: 1, send: () => {} };
  session.black = { id: -1, username: bot.name, rating: bot.rating };
  session.onBotMove = (moveData) => {
    if (session.over) return;
    const { from, to, san, evalBefore, evalAfter } = moveData;
    const delta = (evalAfter || 0) - (evalBefore || 0);
    session.moves.push({ color: botColor, from, to, san, evalBefore, evalAfter, delta });
    stopTimer(session);
    send(human.ws, { type: 'move', color: botColor, from, to, san, evalBefore, evalAfter, delta, isBlunder: false });
    session.turn = humanColor;
    startTimer(session, humanColor);
  };
  games.set(id, session);
  const info = { type: 'game_start', gameId: id, white: { username: human.username, rating: human.rating }, black: { username: bot.name, rating: bot.rating } };
  send(human.ws, { ...info, color: humanColor });
  startTimer(session, 'white');
  console.log('[BOT GAME] started:', human.username, 'vs', bot.name);
}

function processMove(session, ws, color, msg) {
  const { from, to, san, evalBefore, evalAfter } = msg;
  const delta = (evalAfter || 0) - (evalBefore || 0);
  const isBlunder = delta < -2.0;
  session.moves.push({ color, from, to, san, evalBefore, evalAfter, delta });
  stopTimer(session);
  if (session.bot && color === session.humanColor) {
    session.bot.onMove(from, to);
    send(ws, { type: 'move', color, from, to, san, evalBefore, evalAfter, delta, isBlunder });
  } else {
    bcast(session, { type: 'move', color, from, to, san, evalBefore, evalAfter, delta, isBlunder });
  }
  if (isBlunder) { endGame(session, color === 'white' ? 'black' : 'white', ws.player.username + ' blundered'); return; }
  const next = color === 'white' ? 'black' : 'white';
  session.turn = next;
  if (session.bot && next === session.botColor) { session.bot.scheduleMove(); }
  else { startTimer(session, next); }
}

function startTimer(session, color) {
  if (session.bot && color === session.botColor) return;
  session.timerVal = 10;
  session.timer = setInterval(() => {
    session.timerVal--;
    const hw = session.humanColor ? session.whiteWs : null;
    const target = session.bot ? session.whiteWs : null;
    if (session.bot) send(session.whiteWs, { type: 'timer', color, value: session.timerVal });
    else bcast(session, { type: 'timer', color, value: session.timerVal });
    if (session.timerVal <= 0) { stopTimer(session); endGame(session, color === 'white' ? 'black' : 'white', 'Time out'); }
  }, 1000);
}

function stopTimer(session) { if (session.timer) { clearInterval(session.timer); session.timer = null; } }

function endGame(session, winnerColor, reason) {
  if (session.over) return;
  session.over = true;
  stopTimer(session);
  if (session.bot) session.bot.stop();
  console.log('[END]', reason, 'winner:', winnerColor);

  if (session.bot) {
    const human = session.white;
    const humanWon = winnerColor === session.humanColor;
    const delta = humanWon ? 15 : -12;
    const newRating = Math.max(100, human.rating + delta);
    db.run('UPDATE users SET rating=?,peak_rating=MAX(peak_rating,?),wins=wins+?,losses=losses+?,games=games+1,no_ads=CASE WHEN MAX(peak_rating,?)>=1600 THEN 1 ELSE no_ads END WHERE id=?',
      [newRating, newRating, humanWon?1:0, humanWon?0:1, newRating, human.id]);
    const result = { type:'game_over', reason, winner:winnerColor, winnerUsername: humanWon?human.username:session.bot.name,
      ratings:{ white:{old:human.rating,new:newRating,delta}, black:{old:session.bot.rating,new:session.bot.rating,delta:0} },
      noAdsUnlocked:{ white: newRating>=1600&&!human.no_ads, black:false } };
    send(session.whiteWs, result);
    games.delete(session.id);
    return;
  }

  const winner = winnerColor==='white' ? session.white : session.black;
  const loser  = winnerColor==='white' ? session.black : session.white;
  const winnerWs = winnerColor==='white' ? session.whiteWs : session.blackWs;
  const loserWs  = winnerColor==='white' ? session.blackWs : session.whiteWs;
  db.get('SELECT * FROM users WHERE id=?', [winner.id], (e, wu) => {
    db.get('SELECT * FROM users WHERE id=?', [loser.id], (e2, lu) => {
      if (!wu||!lu) return;
      const elo = calculateElo(wu.rating, lu.rating, wu.games, lu.games);
      db.run('UPDATE users SET rating=?,peak_rating=MAX(peak_rating,?),wins=wins+1,games=games+1,no_ads=CASE WHEN MAX(peak_rating,?)>=1600 THEN 1 ELSE no_ads END WHERE id=?',[elo.winnerNew,elo.winnerNew,elo.winnerNew,winner.id]);
      db.run('UPDATE users SET rating=?,peak_rating=MAX(peak_rating,?),losses=losses+1,games=games+1 WHERE id=?',[elo.loserNew,elo.loserNew,loser.id]);
      const dur = Math.round((Date.now()-session.startedAt)/1000);
      db.run("UPDATE games SET winner_id=?,end_reason=?,moves=?,white_delta=?,black_delta=?,duration_secs=?,ended_at=datetime('now') WHERE id=?",
        [winner.id,reason,JSON.stringify(session.moves),winnerColor==='white'?elo.winnerDelta:elo.loserDelta,winnerColor==='black'?elo.winnerDelta:elo.loserDelta,dur,session.id]);
      const result = { type:'game_over', reason, winner:winnerColor, winnerUsername:winner.username,
        ratings:{ white:{old:winnerColor==='white'?wu.rating:lu.rating,new:winnerColor==='white'?elo.winnerNew:elo.loserNew,delta:winnerColor==='white'?elo.winnerDelta:elo.loserDelta},
                  black:{old:winnerColor==='black'?wu.rating:lu.rating,new:winnerColor==='black'?elo.winnerNew:elo.loserNew,delta:winnerColor==='black'?elo.winnerDelta:elo.loserDelta} },
        noAdsUnlocked:{ white:elo.winnerNew>=1600&&winnerColor==='white'&&!wu.no_ads, black:elo.winnerNew>=1600&&winnerColor==='black'&&!wu.no_ads } };
      bcast(session, result);
      games.delete(session.id);
    });
  });
}

function bcast(session, msg) { send(session.whiteWs, msg); send(session.blackWs, msg); }
function send(ws, msg) { if (ws && ws.readyState===1) ws.send(JSON.stringify(msg)); }
function getColor(session, ws) { if (session.whiteWs===ws) return 'white'; if (session.blackWs===ws) return 'black'; return session.humanColor||null; }
function findSession(ws) { for (const s of games.values()) { if (s.whiteWs===ws||s.blackWs===ws) return s; } return null; }
function safeUser(u) { return {id:u.id,username:u.username,rating:u.rating,peak_rating:u.peak_rating,wins:u.wins,losses:u.losses,games:u.games,no_ads:u.no_ads===1}; }

module.exports = { handleConnection };
