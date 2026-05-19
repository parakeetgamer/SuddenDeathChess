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
  pendingFindMatch: false,
};

const GLYPH = null;

const PIECE_SVG = {
  wK:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#FFFFF0;stroke:#2a1f14;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M22.5 11.63V6M20 8h5" stroke-linejoin="miter"/><path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V17s-5.5-1.5-5.5-5.5c0-4 5.5-4.5 5.5-4.5M12.5 30c5.5-3 14.5-3 20 .5M12.5 33.5c5.5-3 14.5-3 20 .5M11.5 37c5.5-3.5 15.5-3.5 21 0" fill="none" stroke-linejoin="miter"/></g></svg>`,
  wQ:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#FFFFF0;stroke:#2a1f14;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M8 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm16.5-4.5a2 2 0 1 1 4 0 2 2 0 0 1-4 0zM33 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0zM9 26a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm27 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0z"/><path d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14z" stroke-linecap="butt"/><path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" stroke-linecap="butt"/><path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c4-1.5 17-1.5 21 0" fill="none"/></g></svg>`,
  wR:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#FFFFF0;stroke:#2a1f14;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M9 39h27v-3H9zM12 36v-4h21v4M11 14V9h4v2h5V9h5v2h5V9h4v5" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M34 14l-3 3H14l-3-3"/><path d="M31 17v12.5H14V17" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M31 29.5l1.5 2.5h-20l1.5-2.5"/><path d="M11 14h23" fill="none" stroke-linejoin="miter"/></g></svg>`,
  wB:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#FFFFF0;stroke:#2a1f14;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><g fill="none"><path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2"/><path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/><path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/></g><path d="M17.5 26h10M15 30h15M22.5 15.5v5M20 18h5" stroke-linejoin="miter"/></g></svg>`,
  wN:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#FFFFF0;stroke:#2a1f14;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/><path d="M24 18c.38 5.12-5.07 7.58-7 10.58C14.56 32 14 35 14 39"/><path d="M9 39c0-4 .7-7.5 3.5-9.5 2-1.5 7.5-5.5 11.5-5"/><path d="M14.5 37c.45-1.67 3-4 4.5-4.5M20 21c-.5 1.5 2.5 3 1.5 4.5" fill="none" stroke-linejoin="miter"/><circle cx="15" cy="15.5" r="1.5" fill="#2a1f14" stroke="none"/><path d="M8 10.5c.5-1.5 1.5-3.5 5-3.5 3 0 4.5 1.5 6 2.5" stroke-linejoin="miter"/></g></svg>`,
  wP:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#FFFFF0;stroke:#2a1f14;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5H34c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"/></g></svg>`,
  bK:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#1A0F0A;stroke:#E8D7B5;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M22.5 11.63V6M20 8h5" stroke-linejoin="miter"/><path d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V17s-5.5-1.5-5.5-5.5c0-4 5.5-4.5 5.5-4.5M12.5 30c5.5-3 14.5-3 20 .5M12.5 33.5c5.5-3 14.5-3 20 .5M11.5 37c5.5-3.5 15.5-3.5 21 0" fill="none" stroke-linejoin="miter"/></g></svg>`,
  bQ:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#1A0F0A;stroke:#E8D7B5;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M8 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm16.5-4.5a2 2 0 1 1 4 0 2 2 0 0 1-4 0zM33 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0zM9 26a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm27 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0z"/><path d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14z" stroke-linecap="butt"/><path d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z" stroke-linecap="butt"/><path d="M11.5 30c3.5-1 18.5-1 22 0M12 33.5c4-1.5 17-1.5 21 0" fill="none"/></g></svg>`,
  bR:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#1A0F0A;stroke:#E8D7B5;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M9 39h27v-3H9zM12 36v-4h21v4M11 14V9h4v2h5V9h5v2h5V9h4v5" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M34 14l-3 3H14l-3-3"/><path d="M31 17v12.5H14V17" stroke-linecap="butt" stroke-linejoin="miter"/><path d="M31 29.5l1.5 2.5h-20l1.5-2.5"/><path d="M11 14h23" fill="none" stroke-linejoin="miter"/></g></svg>`,
  bB:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#1A0F0A;stroke:#E8D7B5;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><g fill="none"><path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2"/><path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z"/><path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/></g><path d="M17.5 26h10M15 30h15M22.5 15.5v5M20 18h5" stroke-linejoin="miter"/></g></svg>`,
  bN:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#1A0F0A;stroke:#E8D7B5;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21"/><path d="M24 18c.38 5.12-5.07 7.58-7 10.58C14.56 32 14 35 14 39"/><path d="M9 39c0-4 .7-7.5 3.5-9.5 2-1.5 7.5-5.5 11.5-5"/><path d="M14.5 37c.45-1.67 3-4 4.5-4.5M20 21c-.5 1.5 2.5 3 1.5 4.5" fill="none" stroke-linejoin="miter"/><circle cx="15" cy="15.5" r="1.5" fill="#E8D7B5" stroke="none"/><path d="M8 10.5c.5-1.5 1.5-3.5 5-3.5 3 0 4.5 1.5 6 2.5" stroke-linejoin="miter"/></g></svg>`,
  bP:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45"><g style="fill:#1A0F0A;stroke:#E8D7B5;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round"><path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03C15.41 27.09 11 31.58 11 39.5H34c0-7.92-4.41-12.41-7.41-13.47C28.06 24.84 29 23.03 29 21c0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"/></g></svg>`,
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
  if (user.no_ads) hideAds();
  if (S.pendingFindMatch) {
    S.pendingFindMatch = false;
    wsSend({ type: 'find_match' });
  }
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
  if (!S.user) { S.pendingFindMatch = true; return; } wsSend({ type: "find_match" });
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
  if (typeof Chess === "undefined") { console.error("chess.js not loaded"); return; } S.chess = new Chess();

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
          const PIECE_IMGS = {
            wK:'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
            wQ:'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
            wR:'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
            wB:'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
            wN:'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
            wP:'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
            bK:'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg',
            bQ:'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
            bR:'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
            bB:'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
            bN:'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
            bP:'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
          };
          const key2 = (p.color==='w' ? 'w' : 'b') + p.type.toUpperCase();
          const pe = document.createElement('img');
          pe.src = PIECE_IMGS[key2];
          pe.className = 'piece';
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
  if (!S.user) { S.pendingFindMatch = true; return; } wsSend({ type: "find_match" });
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
