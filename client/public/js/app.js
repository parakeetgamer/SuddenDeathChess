/**
 * Sudden Death Chess — Frontend App
 * Connects to backend via WebSocket, uses Stockfish.js for real eval
 */

// ══════════════════════════════════════════
// AUDIO ENGINE
// ══════════════════════════════════════════
let actx;
function ga(){ if(!actx) actx=new(window.AudioContext||window.webkitAudioContext)(); return actx; }
function tone(freq,type,dur,vol=.15,atk=.01,dec=.08){
  try{const c=ga(),o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);
  o.type=type;o.frequency.value=freq;const n=c.currentTime;
  g.gain.setValueAtTime(0,n);g.gain.linearRampToValueAtTime(vol,n+atk);
  g.gain.exponentialRampToValueAtTime(.001,n+atk+dec+dur);o.start(n);o.stop(n+atk+dec+dur+.05);}catch(e){}
}
const sndMove    = () => tone(440,'sine',.05,.1,.005,.04);
const sndCapture = () => tone(280,'sawtooth',.08,.14,.005,.07);
const sndGood    = () => { tone(660,'sine',.08,.16,.01,.1); setTimeout(()=>tone(880,'sine',.06,.12,.005,.08),80); };
const sndBlunder = () => { tone(220,'sawtooth',.15,.22,.01,.2); setTimeout(()=>tone(165,'sawtooth',.2,.22,.01,.25),100); setTimeout(()=>tone(110,'sawtooth',.3,.18,.01,.35),220); };
const sndWin     = () => [523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,'sine',.15,.18,.01,.12),i*100));
const sndTick    = () => tone(800,'square',.02,.07,.002,.02);

// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════
const S = {
  token: localStorage.getItem('sdc_token') || null,
  user: null,
  myColor: null,
  gameId: null,
  chess: null,         // chess.js instance
  selected: null,
  legalMoves: [],
  lastFrom: null, lastTo: null,
  moveHistory: [],
  capturedMe: [], capturedOpp: [],
  evalScore: 0,
  gameOver: false,
  timerVal: 10,
  localTimerInterval: null,
  moveTimings: [],
  moveStartTime: 0,
  streak: 0,
  ratingHistory: [],
  ws: null,
};

const GLYPH = {
  wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
  bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'
};

// ══════════════════════════════════════════
// STOCKFISH
// ══════════════════════════════════════════
let stockfish = null;
let evalResolve = null;

function initStockfish() {
  // stockfish.js exposes a global or worker depending on build
  // Using the simple single-file version
  try {
    if (typeof Stockfish !== 'undefined') {
      stockfish = Stockfish();
      stockfish.onmessage = onStockfishMessage;
      stockfish.postMessage('uci');
      stockfish.postMessage('setoption name MultiPV value 1');
      stockfish.postMessage('isready');
    }
  } catch(e) {
    console.warn('Stockfish not loaded, using simulated eval');
  }
}

function onStockfishMessage(event) {
  const msg = typeof event === 'string' ? event : event.data;
  if (!msg) return;
  if (msg.startsWith('info') && msg.includes('score cp')) {
    const match = msg.match(/score cp (-?\d+)/);
    if (match && evalResolve) {
      const cp = parseInt(match[1]) / 100; // centipawns to pawns
      evalResolve(cp);
      evalResolve = null;
    }
  }
}

function getEval(fen) {
  return new Promise((resolve) => {
    if (!stockfish) {
      // Simulate eval if stockfish not loaded
      resolve(S.evalScore + (Math.random() * 0.6 - 0.3));
      return;
    }
    evalResolve = resolve;
    stockfish.postMessage('position fen ' + fen);
    stockfish.postMessage('go movetime 100'); // 100ms think time
    // Timeout fallback
    setTimeout(() => { if(evalResolve){ evalResolve(S.evalScore); evalResolve=null; }}, 200);
  });
}

// ══════════════════════════════════════════
// WEBSOCKET
// ══════════════════════════════════════════
function connectWS() {
  
  const url = `wss://${location.host}/ws`;
  S.ws = new WebSocket(url);

  S.ws.onopen = () => {
    console.log('WS connected');
    // Authenticate immediately
    if (S.token) {
      wsSend({ type: 'auth', token: S.token });
    }
    // Keepalive ping every 25s
    setInterval(() => wsSend({ type: 'ping' }), 25000);
  };

  S.ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleServerMsg(msg);
  };

  S.ws.onclose = () => {
    console.log('WS disconnected — reconnecting in 2s');
    setTimeout(connectWS, 2000);
  };

  S.ws.onerror = () => {};
}

function wsSend(obj) {
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify(obj));
  }
}

function handleServerMsg(msg) {
  switch(msg.type) {
    case 'authed':      return onAuthed(msg.user);
    case 'searching':   return; // already handled locally
    case 'game_start':  return onGameStart(msg);
    case 'move':        return onOpponentMove(msg);
    case 'timer':       return onServerTimer(msg);
    case 'game_over':   return onGameOver(msg);
    case 'cancelled':   return;
    case 'error':       return toast(msg.message);
  }
}

// ══════════════════════════════════════════
// SCREENS
// ══════════════════════════════════════════
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════
let toastT;
function toast(msg) {
  const e = document.getElementById('toast');
  e.textContent = msg;
  e.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => e.classList.remove('show'), 2600);
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════
let signupMode = false;

document.getElementById('btn-toggle').addEventListener('click', () => {
  signupMode = !signupMode;
  document.getElementById('lm-label').textContent = signupMode ? 'Create Account' : 'Sign In';
  document.getElementById('confirm-field').style.display = signupMode ? 'block' : 'none';
  document.getElementById('btn-auth').textContent = signupMode ? 'CREATE & PLAY' : 'PLAY NOW';
  document.getElementById('toggle-text').textContent = signupMode ? 'Already have one?' : 'No account?';
  document.getElementById('btn-toggle').textContent = signupMode ? ' Sign in →' : ' Create one →';
  document.getElementById('err-msg').textContent = '';
});

document.getElementById('btn-auth').addEventListener('click', doAuth);
['inp-user','inp-pass','inp-confirm'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if(e.key==='Enter') doAuth(); });
});

async function doAuth() {
  const username = document.getElementById('inp-user').value.trim();
  const password = document.getElementById('inp-pass').value;
  const errEl = document.getElementById('err-msg');
  errEl.textContent = '';

  if (!username) { errEl.textContent = 'Username required.'; shake('inp-user'); return; }
  if (!password) { errEl.textContent = 'Password required.'; shake('inp-pass'); return; }

  if (signupMode) {
    const confirm = document.getElementById('inp-confirm').value;
    if (password !== confirm) { errEl.textContent = 'Passwords do not match.'; shake('inp-confirm'); return; }
  }

  const endpoint = signupMode ? '/api/auth/register' : '/api/auth/login';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Something went wrong.'; shake('inp-pass'); return; }

    S.token = data.token;
    S.user = data.user;
    S.ratingHistory = [data.user.rating];
    localStorage.setItem('sdc_token', S.token);

    // Auth the WS connection
    wsSend({ type: 'auth', token: S.token });

    updateNavUser();
    loadLeaderboard();
    show('s-lobby');
    toast(`Welcome${signupMode ? '' : ' back'}, ${username}!`);
  } catch(e) {
    errEl.textContent = 'Connection error. Try again.';
  }
}

function onAuthed(user) {
  S.user = user;
  S.ratingHistory = [user.rating];
  updateNavUser();
  // Apply no-ads if unlocked
  if (user.no_ads) hideAds();
}

function updateNavUser() {
  if (!S.user) return;
  document.getElementById('nav-uname').textContent = S.user.username;
  document.getElementById('nav-rating').textContent = S.user.rating;
  document.getElementById('stat-mygames').textContent = S.user.games;
  document.getElementById('stat-streak').textContent = S.streak;
}

function shake(id) {
  const e = document.getElementById(id);
  e.classList.remove('error'); void e.offsetWidth; e.classList.add('error');
  setTimeout(() => e.classList.remove('error'), 400);
}

// ══════════════════════════════════════════
// ADS MANAGEMENT
// ══════════════════════════════════════════
function hideAds() {
  document.querySelectorAll('.ad').forEach(el => {
    el.style.display = 'none';
  });
}

// ══════════════════════════════════════════
// LOBBY
// ══════════════════════════════════════════
let searching = false;

document.getElementById('btn-find').addEventListener('click', () => {
  if (!S.user) return toast('Please log in first.');
  const btn = document.getElementById('btn-find');
  if (searching) {
    wsSend({ type: 'cancel' });
    btn.classList.remove('searching');
    btn.textContent = 'FIND MATCH';
    document.getElementById('search-status').innerHTML = '';
    searching = false;
    return;
  }
  wsSend({ type: 'find_match' });
  btn.classList.add('searching');
  btn.textContent = 'CANCEL';
  document.getElementById('search-status').innerHTML = 'Searching for opponent<span class="dot-anim"></span>';
  searching = true;
});

document.getElementById('nav-user-btn').addEventListener('click', showProfile);
document.getElementById('btn-back-lobby').addEventListener('click', () => show('s-lobby'));

// Live online counter (simulated with slight noise for now)
let onlineBase = 800;
setInterval(() => {
  onlineBase += Math.floor(Math.random() * 7) - 3;
  onlineBase = Math.max(400, onlineBase);
  document.getElementById('stat-online').textContent = onlineBase;
}, 4000);

async function loadLeaderboard() {
  try {
    const res = await fetch('/api/users/leaderboard');
    const users = await res.json();
    const medals = ['🥇','🥈','🥉'];
    const html = users.map((u, i) => `
      <div class="lb-row">
        <span class="lb-rank ${i<3?['gold','silver','bronze'][i]:''}">${i<3?medals[i]:i+1}</span>
        <span class="lb-name ${S.user&&u.username===S.user.username?'you':''}">${u.username}</span>
        <span class="lb-rating">${u.rating}</span>
      </div>`).join('');
    document.getElementById('leaderboard').innerHTML = html || '<div style="color:var(--muted);font-size:12px">No players yet</div>';
  } catch(e) {
    document.getElementById('leaderboard').innerHTML = '<div style="color:var(--muted);font-size:12px">Loading...</div>';
  }
}

// ══════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════
function showProfile() {
  if (!S.user) return;
  const u = S.user;
  document.getElementById('prof-avatar').textContent = u.username[0].toUpperCase();
  document.getElementById('prof-name').textContent = u.username;
  document.getElementById('prof-rating').textContent = u.rating;
  document.getElementById('prof-peak').textContent = u.peak_rating;
  document.getElementById('ps-played').textContent = u.games;
  document.getElementById('ps-wins').textContent = u.wins;
  document.getElementById('ps-losses').textContent = u.losses;
  document.getElementById('ps-winpct').textContent = u.games ? Math.round(u.wins/u.games*100)+'%' : '—';

  const adsEl = document.getElementById('ads-status');
  if (u.no_ads) {
    adsEl.textContent = '✓ Ads disabled — you reached 1600. Legend status.';
    adsEl.className = 'ads-status no-ads';
  } else {
    adsEl.textContent = `Reach 1600 Elo to remove ads forever. (Peak: ${u.peak_rating})`;
    adsEl.className = 'ads-status';
  }

  drawChart();
  show('s-profile');
}

function drawChart() {
  const data = S.ratingHistory;
  const container = document.getElementById('chart-area');
  if (data.length < 2) { container.innerHTML = '<svg></svg>'; return; }
  const W = container.clientWidth || 580, H = 120;
  const min = Math.min(...data) - 20, max = Math.max(...data) + 20;
  const pts = data.map((v,i) => [(i/(data.length-1))*W, H-((v-min)/(max-min))*H]).map(([x,y])=>`${x},${y}`).join(' ');
  const [lx,ly] = [W, H-((data[data.length-1]-min)/(max-min))*H];
  container.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--yellow)" stop-opacity=".3"/>
      <stop offset="100%" stop-color="var(--yellow)" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${pts} ${W},${H} 0,${H}" fill="url(#cg)"/>
    <polyline points="${pts}" fill="none" stroke="var(--yellow)" stroke-width="2"/>
    <circle cx="${lx}" cy="${ly}" r="4" fill="var(--yellow)"/>
  </svg>`;
}

// ══════════════════════════════════════════
// GAME START (from server)
// ══════════════════════════════════════════
function onGameStart(msg) {
  searching = false;
  document.getElementById('btn-find').classList.remove('searching');
  document.getElementById('btn-find').textContent = 'FIND MATCH';
  document.getElementById('search-status').innerHTML = '';

  S.myColor = msg.color;
  S.gameId = msg.gameId;
  S.gameOver = false;
  S.selected = null; S.legalMoves = [];
  S.lastFrom = null; S.lastTo = null;
  S.moveHistory = [];
  S.capturedMe = []; S.capturedOpp = [];
  S.evalScore = 0;
  S.moveTimings = [];
  S.moveStartTime = 0;

  // Init chess.js
  S.chess = new Chess();

  const oppColor = msg.color === 'white' ? 'black' : 'white';
  const opp = msg.color === 'white' ? msg.black : msg.white;
  const me  = msg.color === 'white' ? msg.white : msg.black;

  document.getElementById('g-opp-color').textContent = oppColor === 'white' ? '⬜ White' : '⬛ Black';
  document.getElementById('g-opp-name').textContent = opp.username;
  document.getElementById('g-opp-rating').textContent = opp.rating;
  document.getElementById('g-you-color').textContent = msg.color === 'white' ? '⬜ White' : '⬛ Black';
  document.getElementById('g-you-name').textContent = me.username;
  document.getElementById('g-you-rating').textContent = me.rating;

  updateEvalUI();
  updateMoveLog();
  updateCaptures();
  renderBoard();
  updateTurnUI();
  show('s-game');
  toast(`Game found vs ${opp.username} (${opp.rating})`);

  // Start timer if we go first (white)
  if (msg.color === 'white') startLocalTimer();
}

// ══════════════════════════════════════════
// CHESS BOARD
// ══════════════════════════════════════════
function pieceKey(p) {
  if (!p) return null;
  return (p.color === 'w' ? 'w' : 'b') + p.type.toUpperCase();
}

function renderBoard() {
  const el = document.getElementById('board');
  el.innerHTML = '';

  const flipped = S.myColor === 'black';
  const files = flipped ? 'hgfedcba' : 'abcdefgh';
  const ranks = flipped ? '12345678' : '87654321';

  document.getElementById('coord-files').innerHTML = files.split('').map(f=>`<span>${f}</span>`).join('');
  document.getElementById('coord-ranks').innerHTML = ranks.split('').map(r=>`<span>${r}</span>`).join('');

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const sq = document.createElement('div');
      const file = flipped ? 7-col : col;
      const rank = flipped ? row   : 7-row;
      const squareName = 'abcdefgh'[file] + (rank+1);

      sq.className = 'sq ' + ((row+col)%2===0?'light':'dark');
      sq.dataset.sq = squareName;

      if (S.lastFrom === squareName || S.lastTo === squareName) sq.classList.add('slast');
      if (S.selected === squareName) sq.classList.add('ssel');
      if (S.chess && S.legalMoves.some(m=>m.to===squareName)) {
        const hasCapture = S.chess.get(squareName);
        sq.classList.add(hasCapture ? 'scap' : 'sdot');
      }

      if (S.chess) {
        const p = S.chess.get(squareName);
        if (p) {
          const pe = document.createElement('div');
          pe.className = 'piece ' + (p[0]==='w' ? 'white-piece' : 'black-piece');
          pe.textContent = GLYPH[pieceKey(p)];
          sq.appendChild(pe);
        }
      }

      sq.addEventListener('click', onSqClick);
      el.appendChild(sq);
    }
  }
}

async function onSqClick(e) {
  if (!S.chess || S.gameOver) return;
  if (S.chess.turn() !== S.myColor[0]) return; // not my turn

  const squareName = e.currentTarget.dataset.sq;
  const piece = S.chess.get(squareName);

  // Execute a legal move
  if (S.selected && S.legalMoves.some(m=>m.to===squareName)) {
    await executeMyMove(S.selected, squareName);
    S.selected = null; S.legalMoves = [];
    return;
  }

  // Select my piece
  if (piece && piece.color === S.myColor[0]) {
    S.selected = squareName;
    S.legalMoves = S.chess.moves({ square: squareName, verbose: true });
    renderBoard();
    return;
  }

  S.selected = null; S.legalMoves = [];
  renderBoard();
}

async function executeMyMove(from, to) {
  const evalBefore = S.evalScore;

  // Make the move in chess.js
  const moveObj = S.chess.move({ from, to, promotion: 'q' });
  if (!moveObj) return;

  // Track timing
  if (S.moveStartTime > 0) {
    S.moveTimings.push((Date.now() - S.moveStartTime) / 1000);
    S.moveStartTime = 0;
  }

  stopLocalTimer();

  S.lastFrom = from; S.lastTo = to;
  if (moveObj.captured) sndCapture(); else sndMove();

  // Get eval from Stockfish
  const evalAfter = await getEval(S.chess.fen());
  // From white's perspective
  const rawDelta = evalAfter - evalBefore;
  const delta = S.myColor === 'white' ? rawDelta : -rawDelta;

  S.evalScore = evalAfter;

  const quality = delta > 0.3 ? 'good' : (delta < -2.0 ? 'blunder' : delta < -0.3 ? 'inaccuracy' : '');
  S.moveHistory.push({ san: moveObj.san, color: S.myColor, quality, captured: moveObj.captured });

  updateMoveLog();
  updateEvalUI();
  renderBoard();

  if (moveObj.captured) {
    S.capturedMe.push((S.myColor==='white'?'b':'w') + moveObj.captured.toUpperCase());
    updateCaptures();
  }

  // Send to server
  wsSend({
    type: 'move',
    from, to,
    san: moveObj.san,
    evalBefore,
    evalAfter,
  });

  // Visual feedback (server will confirm blunder, but show local feedback)
  if (quality === 'good') {
    flashB('fg'); flashOv('rgba(45,198,83,.14)'); showFB('NICE ✓', 'var(--green)'); sndGood();
  } else if (quality !== 'blunder') {
    flashB('fg'); flashOv('rgba(45,198,83,.10)'); showFB('OK', 'var(--white-dim)');
  }

  updateTurnUI();
}

// Opponent's move comes from server
function onOpponentMove(msg) {
  if (!S.chess || msg.color === S.myColor) return;
  if (msg.isBlunder) return; // server will send game_over

  const moveObj = S.chess.move({ from: msg.from, to: msg.to, promotion: 'q' });
  if (!moveObj) return;

  S.lastFrom = msg.from; S.lastTo = msg.to;
  if (moveObj.captured) sndCapture(); else sndMove();

  if (moveObj.captured) {
    S.capturedOpp.push((S.myColor==='white'?'w':'b') + moveObj.captured.toUpperCase());
    updateCaptures();
  }

  S.evalScore = msg.evalAfter || S.evalScore;
  S.moveHistory.push({ san: moveObj.san, color: msg.color, quality: '' });

  updateMoveLog();
  updateEvalUI();
  renderBoard();
  updateTurnUI();
  startLocalTimer();
}

// Server timer sync
function onServerTimer(msg) {
  // Sync local timer with server if drifted
  if (Math.abs(S.timerVal - msg.value) > 1) {
    S.timerVal = msg.value;
    updateTimerUI();
  }
}

// ══════════════════════════════════════════
// LOCAL TIMER (mirrors server timer)
// ══════════════════════════════════════════
function startLocalTimer() {
  S.timerVal = 10;
  S.moveStartTime = Date.now();
  updateTimerUI();
  S.localTimerInterval = setInterval(() => {
    S.timerVal--;
    if (S.timerVal <= 3 && S.timerVal > 0) sndTick();
    updateTimerUI();
    if (S.timerVal <= 0) stopLocalTimer();
  }, 1000);
}

function stopLocalTimer() {
  clearInterval(S.localTimerInterval);
  S.localTimerInterval = null;
}

function updateTimerUI() {
  const el = document.getElementById('timer-num');
  const fill = document.getElementById('timer-fill');
  el.textContent = S.timerVal;
  fill.style.width = (S.timerVal/10*100)+'%';
  el.className = 'timer-big ' + (S.timerVal>5?'ok':S.timerVal>2?'warn':'crit');
  fill.style.background = S.timerVal>5?'var(--green)':S.timerVal>2?'var(--yellow)':'var(--red)';
}

// ══════════════════════════════════════════
// EVAL UI
// ══════════════════════════════════════════
function updateEvalUI() {
  const score = S.myColor === 'white' ? S.evalScore : -S.evalScore;
  const pct = Math.min(92, Math.max(8, 50+(score/6)*42));
  document.getElementById('eval-fill').style.height = pct+'%';
  document.getElementById('eval-num').textContent = (score>0?'+':'')+score.toFixed(1);
  const lastDelta = S.moveHistory.length ? Math.abs(Math.min(0, S.evalScore - (S.moveHistory.length>1?S.moveHistory[S.moveHistory.length-2].eval||0:0))) : 0;
  document.getElementById('bm-fill').style.width = Math.min(100,(lastDelta/2.0)*100)+'%';
}

// ══════════════════════════════════════════
// TURN UI
// ══════════════════════════════════════════
function updateTurnUI() {
  if (!S.chess) return;
  const myTurn = S.chess.turn() === S.myColor[0];
  const youBlock = document.getElementById('block-you');
  const oppBlock = document.getElementById('block-opp');
  youBlock.className = 'pblock' + (myTurn ? ' at' : '');
  oppBlock.className = 'pblock' + (!myTurn ? ' at' : '');
  if (myTurn && S.timerVal <= 3) youBlock.classList.add('dt');
  const st = document.getElementById('game-status');
  st.innerHTML = myTurn
    ? '<span class="hi">Your turn</span> — make a move'
    : '<span class="gr">Opponent</span> thinking...';
}

// ══════════════════════════════════════════
// MOVE LOG
// ══════════════════════════════════════════
function updateMoveLog() {
  const el = document.getElementById('move-log');
  el.innerHTML = '';
  for (let i = 0; i < S.moveHistory.length; i += 2) {
    const w = S.moveHistory[i], b = S.moveHistory[i+1];
    const row = document.createElement('div');
    row.className = 'mpair';
    row.innerHTML = `<span class="mn">${i/2+1}.</span><span class="mc ${w.quality||''}">${w.san}</span><span class="mc ${b?b.quality||'':''}">${b?b.san:''}</span>`;
    el.appendChild(row);
  }
  el.scrollTop = el.scrollHeight;
}

// ══════════════════════════════════════════
// CAPTURES
// ══════════════════════════════════════════
function updateCaptures() {
  document.getElementById('cap-you').innerHTML = S.capturedMe.map(p=>`<span>${GLYPH[p]||''}</span>`).join('');
  document.getElementById('cap-opp').innerHTML = S.capturedOpp.map(p=>`<span>${GLYPH[p]||''}</span>`).join('');
}

// ══════════════════════════════════════════
// FLASH / FEEDBACK
// ══════════════════════════════════════════
function flashB(cls) {
  const b = document.getElementById('board');
  b.classList.remove('fg','fr'); void b.offsetWidth; b.classList.add(cls);
  setTimeout(()=>b.classList.remove('fg','fr'), 600);
}
function flashOv(color) {
  const e = document.getElementById('flash');
  e.style.background = color; e.style.opacity = 1;
  setTimeout(()=>e.style.opacity=0, 250);
}
function showFB(text, color) {
  const e = document.getElementById('feedback-text');
  e.textContent = text; e.style.color = color;
  e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop');
}

// ══════════════════════════════════════════
// RESIGN
// ══════════════════════════════════════════
document.getElementById('btn-resign').addEventListener('click', () => {
  if (!S.gameId || S.gameOver) return;
  if (confirm('Resign this game?')) wsSend({ type: 'resign' });
});

// ══════════════════════════════════════════
// GAME OVER
// ══════════════════════════════════════════
function onGameOver(msg) {
  S.gameOver = true;
  stopLocalTimer();

  const iWon = msg.winner === S.myColor;
  if (iWon) { sndWin(); S.streak++; flashB('fg'); flashOv('rgba(45,198,83,.2)'); }
  else { sndBlunder(); S.streak = 0; flashB('fr'); flashOv('rgba(230,57,70,.25)'); }

  const myRatings = msg.ratings[S.myColor];

  // Update local user state
  if (S.user) {
    S.user.rating = myRatings.new;
    S.user.peak_rating = Math.max(S.user.peak_rating||0, myRatings.new);
    if (iWon) S.user.wins++; else S.user.losses++;
    S.user.games++;
    S.ratingHistory.push(myRatings.new);
    updateNavUser();
    document.getElementById('nav-rating').textContent = myRatings.new;
    if (myRatings.new >= 1600 && !S.user.no_ads) { S.user.no_ads = true; hideAds(); }
  }

  const myMoves = S.moveHistory.filter(m => m.color === S.myColor);
  const acc = myMoves.length ? Math.round(myMoves.filter(m=>m.quality!=='blunder'&&m.quality!=='inaccuracy').length/myMoves.length*100) : 100;
  const avgT = S.moveTimings.length ? Math.round(S.moveTimings.reduce((a,b)=>a+b,0)/S.moveTimings.length) : '—';

  document.getElementById('m-icon').textContent = iWon ? '👑' : '💀';
  document.getElementById('m-title').textContent = iWon ? 'VICTORY' : 'DEFEATED';
  document.getElementById('m-title').className = 'modal-title ' + (iWon?'win':'loss');
  document.getElementById('m-reason').textContent = msg.reason;
  document.getElementById('m-r-old').textContent = myRatings.old;
  document.getElementById('m-r-new').textContent = myRatings.new;
  const de = document.getElementById('m-r-delta');
  de.textContent = (myRatings.delta >= 0 ? '+' : '') + myRatings.delta;
  de.className = 'r-delta ' + (myRatings.delta >= 0 ? 'up' : 'dn');
  document.getElementById('m-moves').textContent = myMoves.length;
  document.getElementById('m-acc').textContent = acc + '%';
  document.getElementById('m-time').textContent = typeof avgT === 'number' ? avgT+'s' : avgT;

  const noAdsEl = document.getElementById('no-ads-unlock');
  noAdsEl.style.display = (msg.noAdsUnlocked && msg.noAdsUnlocked[S.myColor]) ? 'block' : 'none';

  loadLeaderboard();
  setTimeout(() => document.getElementById('result-modal').classList.add('show'), 500);
}

document.getElementById('btn-rematch').addEventListener('click', () => {
  document.getElementById('result-modal').classList.remove('show');
  wsSend({ type: 'find_match' });
  const btn = document.getElementById('btn-find');
  btn.classList.add('searching'); btn.textContent = 'CANCEL';
  document.getElementById('search-status').innerHTML = 'Searching for opponent<span class="dot-anim"></span>';
  searching = true;
  show('s-lobby');
});

document.getElementById('btn-to-lobby').addEventListener('click', () => {
  document.getElementById('result-modal').classList.remove('show');
  show('s-lobby');
});

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
(async function init() {
  connectWS();
  initStockfish();

  // Auto-login if token exists
  if (S.token) {
    try {
      const res = await fetch('/api/users/me', {
        headers: { 'Authorization': 'Bearer ' + S.token }
      });
      if (res.ok) {
        S.user = await res.json();
        S.ratingHistory = [S.user.rating];
        updateNavUser();
        if (S.user.no_ads) hideAds();
        loadLeaderboard();
        show('s-lobby');
      } else {
        localStorage.removeItem('sdc_token');
        S.token = null;
      }
    } catch(e) {}
  }
})();
