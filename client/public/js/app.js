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
const sndHeart   = () => { tone(70,'sine',.10,.30,.005,.10); setTimeout(()=>tone(55,'sine',.13,.26,.005,.13),140); };

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
  judging: false,        // true during the suspense/verdict beat
  preMoveEval: null,     // cached white-POV eval of position before my move
  timerVal: 10,
  localTimerInterval: null,
  moveTimings: [],
  moveStartTime: 0,
  streak: 0,
  ratingHistory: [],
  ws: null,
  pendingFindMatch: false,
};

const GLYPH = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};

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
// STOCKFISH ENGINE (proper queued wrapper)
// ══════════════════════════════════════════
// Returns evals in WHITE'S PERSPECTIVE always.
// +N means white is up N pawns. -N means black is up.
// Internally handles the side-to-move flip that UCI reports.
// ══════════════════════════════════════════
// STOCKFISH — fresh worker per evaluation
// ══════════════════════════════════════════
// A persistent shared worker proved impossible to keep alive in this app
// (engine went mute after the first handshake). Instead we spin up a brand-new
// Worker for every eval — which is proven reliable — and terminate it when done.
// Returns eval in pawns, WHITE'S PERSPECTIVE. Resolves 0 on any failure.

const SF = { THINK_MS: 1500 };

function initStockfish() { /* no-op: workers are created per eval now */ }

function sfEval(fen, movetime) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker('/js/stockfish.js');
    } catch (e) {
      console.error('[SF] worker create failed:', e);
      resolve(0);
      return;
    }

    const sideToMove = fen.split(' ')[1]; // 'w' or 'b'
    let latestCp = null, latestMate = null, latestDepth = 0;
    let gotUciok = false, done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(hardTimer);
      try { worker.terminate(); } catch (e) {}

      let whiteCp;
      if (latestMate !== null) {
        const mateForStm = latestMate > 0 ? 100 : -100;
        whiteCp = sideToMove === 'w' ? mateForStm * 100 : -mateForStm * 100;
      } else if (latestCp !== null) {
        whiteCp = sideToMove === 'w' ? latestCp : -latestCp;
      } else {
        whiteCp = 0;
      }
      console.log('[SF] depth', latestDepth || '?', 'eval(W):', (whiteCp/100).toFixed(2));
      resolve(whiteCp / 100);
    };

    worker.onmessage = (event) => {
      const msg = typeof event === 'string' ? event : event.data;
      if (!msg || typeof msg !== 'string') return;
      if (window._sfDebug) console.log('[SF raw]', msg);

      if (!gotUciok) {
        if (msg.startsWith('uciok')) {
          gotUciok = true;
          worker.postMessage('setoption name MultiPV value 1');
          worker.postMessage('position fen ' + fen);
          worker.postMessage('go movetime ' + (movetime || SF.THINK_MS));
        }
        return;
      }

      if (msg.startsWith('info') && msg.includes('score')) {
        const d = msg.match(/ depth (\d+)/);
        if (d) latestDepth = parseInt(d[1]);
        const m = msg.match(/score mate (-?\d+)/);
        const c = msg.match(/score cp (-?\d+)/);
        if (m) { latestMate = parseInt(m[1]); latestCp = null; }
        else if (c) { latestCp = parseInt(c[1]); latestMate = null; }
        return;
      }

      if (msg.startsWith('bestmove')) {
        finish();
      }
    };

    worker.onerror = (e) => { console.error('[SF] worker error:', e && e.message); finish(); };

    // Kick off the handshake. Poll uci until uciok (engine drops early commands).
    let tries = 0;
    const pollUci = setInterval(() => {
      if (gotUciok || done || tries > 25) { clearInterval(pollUci); return; }
      tries++;
      worker.postMessage('uci');
    }, 250);

    // Hard timeout: whatever we have, resolve and clean up.
    const hardTimer = setTimeout(() => {
      clearInterval(pollUci);
      console.warn('[SF] hard timeout for fen', fen);
      finish();
    }, (movetime || SF.THINK_MS) + 2500);
  });
}

function sfEvalShallow(fen) { return sfEval(fen, 150); }

// No queue to clear anymore — each eval is independent. Kept for call-site compat.
function sfEvalLatest(fen) { return sfEval(fen); }

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
  S._gameOverFired = false;
  S.selected = null; S.legalMoves = []; renderBoard();
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
  // Inject emergency abandon button if not present
  if (!document.getElementById('abandon-btn')) {
    const topbar = document.querySelector('#s-game .topbar') || document.querySelector('.status')?.parentElement;
    if (topbar) {
      const btn = document.createElement('button');
      btn.id = 'abandon-btn';
      btn.textContent = 'ABANDON';
      btn.onclick = window.abandonGame;
      btn.style.cssText = 'background:rgba(225,29,46,0.15);border:1px solid rgba(225,29,46,0.4);color:#E11D2E;padding:8px 16px;border-radius:4px;font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:2px;cursor:pointer;margin-left:16px;text-transform:uppercase;';
      topbar.appendChild(btn);
    }
  }

  boardBuilt = false;
  S._flipped = undefined;

  // Pre-game countdown overlay
  startPreGameCountdown(msg.color === 'white');
}

// ══════════════════════════════════════════
// CHESS BOARD
// ══════════════════════════════════════════
function pieceKey(p) {
  if (!p) return null;
  return (p.color === 'w' ? 'w' : 'b') + p.type.toUpperCase();
}


// ══════════════════════════════════════════
// PRE-GAME COUNTDOWN
// ══════════════════════════════════════════
function startPreGameCountdown(iGoFirst) {
  // Create overlay
  let overlay = document.getElementById('pregame-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pregame-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:850;display:flex;align-items:center;justify-content:center;background:rgba(14,17,22,0.85);backdrop-filter:blur(12px);';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  let val = 3;
  const render = () => {
    overlay.innerHTML = `
      <div style="text-align:center;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:6px;color:#A1A1AA;text-transform:uppercase;margin-bottom:24px;">${iGoFirst ? 'You play first' : 'Opponent plays first'}</div>
        <div id="cd-num" style="font-family:'Antonio',sans-serif;font-size:200px;font-weight:700;line-height:1;color:${val===0?'#FF7A1A':'#F5F1EA'};text-shadow:0 0 60px ${val===0?'rgba(255,122,26,0.8)':'rgba(245,241,234,0.4)'};animation:cdPop 1s ease-out;">${val===0?'GO':val}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:4px;color:#52525B;text-transform:uppercase;margin-top:24px;">One blunder = instant death</div>
      </div>
    `;
    sndTick();
  };
  render();
  const tick = setInterval(() => {
    val--;
    render();
    if (val < 0) {
      clearInterval(tick);
      overlay.style.display = 'none';
      if (iGoFirst) startLocalTimer();
    }
  }, 1000);
}

// Preloaded piece images (load once, reuse forever - no flicker)
const PIECE_IMGS_URLS = {
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
// Preload all pieces immediately so they're cached
Object.values(PIECE_IMGS_URLS).forEach(url => { const i = new Image(); i.src = url; });

// Build board ONCE, then only mutate what changes (no flicker)
let boardBuilt = false;
function buildBoardOnce() {
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
      sq.addEventListener('click', onSqClick);
      el.appendChild(sq);
    }
  }
  boardBuilt = true;
}

function renderBoard() {
  if (!boardBuilt || S._flipped !== (S.myColor === 'black')) {
    S._flipped = S.myColor === 'black';
    buildBoardOnce();
  }
  if (!S.chess) return;

  const boardEl = document.getElementById('board');
  const squares = boardEl.children;

  for (let i = 0; i < squares.length; i++) {
    const sq = squares[i];
    const squareName = sq.dataset.sq;

    const isLast = S.lastFrom === squareName || S.lastTo === squareName;
    const isSel = S.selected === squareName;
    const isLegal = S.legalMoves.some(m => m.to === squareName);
    const hasCapture = isLegal && S.chess.get(squareName);

    sq.classList.toggle('slast', isLast);
    sq.classList.toggle('ssel', isSel);
    sq.classList.toggle('sdot', isLegal && !hasCapture);
    sq.classList.toggle('scap', !!hasCapture);

    const p = S.chess.get(squareName);
    const wantKey = p ? (p.color === 'w' ? 'w' : 'b') + p.type.toUpperCase() : null;
    const currentImg = sq.querySelector('img.piece');
    const currentKey = currentImg ? currentImg.dataset.k : null;

    if (wantKey !== currentKey) {
      if (currentImg && !wantKey) {
        currentImg.remove();
      } else if (currentImg && wantKey) {
        // Just update src + key, don't recreate the element
        currentImg.src = PIECE_IMGS_URLS[wantKey];
        currentImg.dataset.k = wantKey;
      } else if (wantKey) {
        const pe = document.createElement('img');
        pe.src = PIECE_IMGS_URLS[wantKey];
        pe.dataset.k = wantKey;
        pe.draggable = false;
        pe.className = 'piece';
        sq.appendChild(pe);
      }
    }
  }
}

async function onSqClick(e) {
  if (!S.chess || S.gameOver || S.judging) return;
  if (S.chess.turn() !== S.myColor[0]) return; // not my turn

  const squareName = e.currentTarget.dataset.sq;
  const piece = S.chess.get(squareName);

  // Execute a legal move
  if (S.selected && S.legalMoves.some(m=>m.to===squareName)) {
    const fromSq = S.selected;
    S.selected = null;
    S.legalMoves = [];
    await executeMyMove(fromSq, squareName);
    renderBoard();
    return;
  }

  // Select my piece
  if (piece && piece.color === S.myColor[0]) {
    S.selected = squareName;
    S.legalMoves = S.chess.moves({ square: squareName, verbose: true });
    renderBoard();
    return;
  }

  S.selected = null; S.legalMoves = []; renderBoard();
  renderBoard();
}

// Full-screen green (safe) / red (blunder) flash on every verdict.
function verdictFlash(color) {
  // Superseded by the board-edge glow (boardGlow). Kept as a no-op so old
  // call sites don't break.
}

// Board-edge status glow. states: 'idle' | 'judging' | 'good' | 'supergood' | 'bad' | 'superbad'
let _boardGlowTimer = null;
function boardGlow(state, holdMs) {
  const b = document.getElementById('board');
  if (!b) return;
  b.classList.remove('bg-judging','bg-good','bg-supergood','bg-bad','bg-superbad');
  if (_boardGlowTimer) { clearTimeout(_boardGlowTimer); _boardGlowTimer = null; }
  if (!state || state === 'idle') return;  // back to the ambient white pulse
  b.classList.add('bg-' + state);
  if (holdMs) {
    _boardGlowTimer = setTimeout(() => {
      b.classList.remove('bg-' + state);
    }, holdMs);
  }
}

// ══════════════════════════════════════════
// PARKOUR JUDGING BEAT — blocky guy leaps a gap; eval decides stick vs faceplant
// ══════════════════════════════════════════
// (judging is now minimal: executeMyMove awaits the eval, then verdictFlash green/red)

// Crack + shatter the whole board outward from the blundered square.
function shatterBoard(toSquare) {
  const board = document.getElementById('board');
  if (!board) return;
  const rect = board.getBoundingClientRect();
  const sq = document.querySelector('#board [data-sq="' + toSquare + '"]');
  let ox = 0.5, oy = 0.5;
  if (sq) {
    const sr = sq.getBoundingClientRect();
    ox = (sr.left + sr.width/2 - rect.left) / rect.width;
    oy = (sr.top + sr.height/2 - rect.top) / rect.height;
  }

  // violent shake on the whole game
  const game = document.getElementById('s-game');
  if (game) { game.classList.add('shatter-shake'); setTimeout(()=>game.classList.remove('shatter-shake'), 700); }

  // SVG crack lines radiating from the blunder origin
  const ov = document.createElement('div');
  ov.className = 'shatter-overlay';
  ov.style.left = rect.left + 'px';
  ov.style.top = rect.top + 'px';
  ov.style.width = rect.width + 'px';
  ov.style.height = rect.height + 'px';
  const cx = (ox*100).toFixed(1), cy = (oy*100).toFixed(1);
  let cracks = '';
  const N = 9;
  for (let i = 0; i < N; i++) {
    const ang = (i/N)*Math.PI*2 + Math.random()*0.5;
    let px = ox*100, py = oy*100, d = 'M' + px + ',' + py;
    let len = 14 + Math.random()*10;
    for (let seg = 0; seg < 4; seg++) {
      const jit = (Math.random()-0.5)*18;
      px += Math.cos(ang)*len + Math.cos(ang+1.57)*jit;
      py += Math.sin(ang)*len + Math.sin(ang+1.57)*jit;
      d += ' L' + px.toFixed(1) + ',' + py.toFixed(1);
      len *= 1.1;
    }
    cracks += '<path d="' + d + '" />';
  }
  ov.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none">' +
    '<g stroke="#fff" stroke-width="0.5" fill="none" opacity="0.9">' + cracks + '</g>' +
    '<circle cx="'+cx+'" cy="'+cy+'" r="2" fill="#fff"/></svg>';
  document.body.appendChild(ov);

  // fragment shards flying off
  const frag = document.createElement('div');
  frag.className = 'shatter-frags';
  frag.style.left = rect.left + 'px'; frag.style.top = rect.top + 'px';
  frag.style.width = rect.width + 'px'; frag.style.height = rect.height + 'px';
  for (let i = 0; i < 16; i++) {
    const f = document.createElement('div');
    f.className = 'frag';
    f.style.left = (Math.random()*85) + '%';
    f.style.top = (Math.random()*85) + '%';
    f.style.setProperty('--fx', ((Math.random()-0.5)*400).toFixed(0)+'px');
    f.style.setProperty('--fy', (200 + Math.random()*300).toFixed(0)+'px');
    f.style.setProperty('--fr', ((Math.random()-0.5)*720).toFixed(0)+'deg');
    f.style.setProperty('--fd', (Math.random()*0.15).toFixed(2)+'s');
    frag.appendChild(f);
  }
  document.body.appendChild(frag);

  setTimeout(() => { ov.remove(); frag.remove(); }, 1600);
}

// Spawn the particle/shockwave explosion on the blundered square.
function explodePiece(toSquare) {
  const sq = document.querySelector('#board [data-sq="' + toSquare + '"]');
  if (!sq) return;
  const piece = sq.querySelector('img.piece');
  if (piece) piece.classList.add('exploding-piece');

  const burst = document.createElement('div');
  burst.className = 'explosion';
  const ring = document.createElement('div');
  ring.className = 'shockwave';
  burst.appendChild(ring);
  const N = 11;
  for (let i = 0; i < N; i++) {
    const sh = document.createElement('div');
    sh.className = 'shard';
    const ang = (i / N) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 38 + Math.random() * 34;
    sh.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
    sh.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
    sh.style.setProperty('--rot', (Math.random() * 360).toFixed(0) + 'deg');
    burst.appendChild(sh);
  }
  sq.appendChild(burst);
  setTimeout(() => { burst.remove(); if (piece) piece.classList.remove('exploding-piece'); }, 1100);
}

async function executeMyMove(from, to) {
  if (S.judging || S.gameOver) return;

  // Capture the TRUE position before the move (fresh baseline, no stale cache).
  const fenBefore = S.chess.fen();
  S.preMoveEval = null;

  // Make the move — INSTANT.
  const moveObj = S.chess.move({ from, to, promotion: 'q' });
  if (!moveObj) return;

  if (S.moveStartTime > 0) {
    S.moveTimings.push((Date.now() - S.moveStartTime) / 1000);
    S.moveStartTime = 0;
  }

  stopLocalTimer();
  S.timerVal = 10;
  updateTimerUI();
  // hand the clock to the opponent — pause our display until it's our turn again
  S.lastFrom = from; S.lastTo = to;
  if (moveObj.captured) sndCapture(); else sndMove();
  S.selected = null; S.legalMoves = [];
  renderBoard();
  if (moveObj.captured) {
    S.capturedMe.push((S.myColor==='white'?'b':'w') + moveObj.captured.toUpperCase());
    updateCaptures();
  }

  // JUDGING: eval true before AND after positions, fresh, in parallel.
  S.judging = true;
  boardGlow('judging');
  const fenAfter = S.chess.fen();

  const [evalBeforeWhitePOV, evalAfterWhitePOV] = await Promise.all([
    sfEval(fenBefore),
    sfEval(fenAfter),
  ]);

  S.judging = false;

  await runVerdict({ moveObj, from, to, evalBeforeWhitePOV, evalAfterWhitePOV });
}

// Builds blunderDetail, decides safe vs blunder, drives reveal + networking.
async function runVerdict({ moveObj, from, to, evalBeforeWhitePOV, evalAfterWhitePOV }) {
  const VALS = {p:1, n:3, b:3, r:5, q:9, k:0};
  const pieceNames = {p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'};
  const BLUNDER_THRESHOLD = 1.5;  // matches server BLUNDER_THRESH (-1.5)

  // Raw drop in MY favor (positive = I lost ground).
  const rawDrop = S.myColor === 'white'
    ? evalBeforeWhitePOV - evalAfterWhitePOV
    : evalAfterWhitePOV - evalBeforeWhitePOV;
  // evalBefore is measured with ME to move, so the engine reports it from the
  // optimistic "I play the best move" view; evalAfter is with the OPPONENT to
  // move. That side-to-move flip adds a systematic tempo swing (~0.5-0.7) to
  // every move, even good ones. Subtract it so only real losses count.
  const TEMPO_OFFSET = 0.7;
  const evalDrop = rawDrop - TEMPO_OFFSET;

  console.log('[SF]',
    'before(W):', (evalBeforeWhitePOV||0).toFixed(2),
    'after(W):', (evalAfterWhitePOV||0).toFixed(2),
    'drop(me):', evalDrop.toFixed(2),
    'myColor:', S.myColor);

  S.evalScore = evalAfterWhitePOV;

  const isClientBlunder = evalDrop >= BLUNDER_THRESHOLD;
  const worstLoss = Math.max(0, evalDrop);

  // move-log color
  const playerPovDelta = -evalDrop;
  const quality = isClientBlunder ? 'blunder'
                : playerPovDelta > 0.8 ? 'good'
                : playerPovDelta < -0.3 ? 'inaccuracy'
                : '';
  S.moveHistory.push({ san: moveObj.san, color: S.myColor, quality, captured: moveObj.captured });
  updateMoveLog();
  updateEvalUI();

  // ════════════ BLUNDER ════════════
  if (isClientBlunder) {
    // Build human-readable explanation
    let blunderDetail = null;
    const opponentMoves = S.chess.moves({ verbose: true });
    const myPieceValue = VALS[moveObj.piece] || 0;
    for (const om of opponentMoves) {
      if (om.to === to && om.captured) {
        const test = new Chess(S.chess.fen());
        test.move({ from: om.from, to: om.to, promotion: 'q' });
        const ourRecaptures = test.moves({ verbose: true }).filter(rm => rm.to === to && rm.captured);
        blunderDetail = {
          lostPiece: pieceNames[moveObj.piece] || moveObj.piece,
          lostValue: myPieceValue,
          attackerPiece: pieceNames[om.piece] || om.piece,
          attackerFrom: om.from,
          attackerTo: om.to,
          defended: ourRecaptures.length > 0,
          recaptureValue: ourRecaptures.length > 0 ? (VALS[om.piece] || 0) : 0,
          netLoss: evalDrop.toFixed(1)
        };
        break;
      }
    }
    if (!blunderDetail) {
      blunderDetail = {
        lostPiece: 'positional advantage',
        lostValue: evalDrop.toFixed(1) + ' pawns',
        attackerPiece: 'opponent threat',
        attackerFrom: '?', attackerTo: '?',
        defended: false, recaptureValue: 0,
        netLoss: evalDrop.toFixed(1), positional: true
      };
    }

    S.gameOver = true;
    stopLocalTimer();
    boardGlow(evalDrop >= 3.0 ? 'superbad' : 'bad', 1400);
    explodePiece(to);
    shatterBoard(to);
    wsSend({ type: 'blunder', san: moveObj.san, worstLoss, detail: blunderDetail });

    // Dramatic red reveal
    sndBlunder();
    const reactions = [
      { text: 'BLUNDER', sub: 'You hung that piece' },
      { text: 'CATASTROPHIC', sub: 'Game over, you' },
      { text: 'OOF', sub: 'That was painful to watch' },
      { text: 'YIKES', sub: 'What were you thinking?' },
      { text: 'DEFEATED', sub: 'One mistake, one death' },
      { text: 'EXECUTED', sub: 'The blunder claims another' },
      { text: 'DISASTER', sub: 'You walked right into it' },
      { text: 'FATAL', sub: 'No coming back from that' },
      { text: 'BRUTAL', sub: 'Hope you have a backup queen' },
      { text: 'TRAGIC', sub: 'So close yet so far' },
    ];
    const r = reactions[Math.floor(Math.random() * reactions.length)];
    const flash = document.createElement('div'); flash.className = 'blunder-flash';
    document.body.appendChild(flash);
    const text = document.createElement('div'); text.className = 'blunder-text'; text.textContent = r.text;
    document.body.appendChild(text);
    const sub = document.createElement('div'); sub.className = 'blunder-sub'; sub.textContent = r.sub;
    document.body.appendChild(sub);
    setTimeout(() => { flash.remove(); text.remove(); sub.remove(); }, 2500);

    // Failsafe local game-over if server is slow
    setTimeout(() => {
      if (!S._gameOverFired && !document.getElementById('result-modal').classList.contains('show')) {
        console.log('[BLUNDER] Server slow, forcing local game over');
        onGameOver({
          type: 'game_over',
          reason: 'You blundered — ' + moveObj.san,
          blunderDetail,
          winner: S.myColor === 'white' ? 'black' : 'white',
          winnerUsername: S.opponent ? S.opponent.username : 'Opponent',
          ratings: {
            white: { old: S.user.rating, new: Math.max(100, S.user.rating - 12), delta: -12 },
            black: { old: S.user.rating, new: Math.max(100, S.user.rating - 12), delta: -12 }
          },
          noAdsUnlocked: { white: false, black: false }
        });
      }
    }, 1500);
    return;
  }

  // ════════════ SAFE ════════════
  boardGlow(playerPovDelta >= 1.5 ? 'supergood' : 'good', 1100);
  // Quick green pulse on the square you survived
  const safeSq = document.querySelector('#board [data-sq="' + to + '"]');
  if (safeSq) {
    safeSq.classList.add('verdict-safe');
    setTimeout(() => safeSq.classList.remove('verdict-safe'), 600);
  }
  // Genuinely good move (eval gained ≥0.8) gets a reward flash
  if (quality === 'good') {
    sndGood();
    const flash = document.createElement('div'); flash.className = 'good-flash';
    document.body.appendChild(flash);
    const gt = document.createElement('div'); gt.className = 'good-text';
    gt.textContent = moveObj.captured ? 'NICE TAKE' : 'GOOD MOVE';
    document.body.appendChild(gt);
    setTimeout(() => { flash.remove(); gt.remove(); }, 1000);
  }

  // You survived. Send the move to the server now (held until verdict so the
  // opponent never sees a move that turns out to be fatal).
  wsSend({
    type: 'move',
    from, to,
    san: moveObj.san,
    evalBefore: evalBeforeWhitePOV,
    evalAfter: evalAfterWhitePOV,
  });

  // Checkmate / stalemate after a SAFE move
  if (S.chess.in_checkmate()) {
    console.log('[CHECKMATE detected]');
    wsSend({ type: 'checkmate', winner: S.myColor });
  } else if (S.chess.in_stalemate() || S.chess.in_draw()) {
    console.log('[DRAW detected]');
    wsSend({ type: 'draw' });
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

  // Opponent move: same judging beat as mine — lock the board during eval.
  S.judging = true;
  boardGlow('judging');
  sfEval(S.chess.fen()).then(ev => {
    const oppStanding = S.myColor === 'white' ? ev : -ev;
    boardGlow(oppStanding < -1.5 ? 'bad' : oppStanding > 1.5 ? 'good' : 'idle', 1100);
    S.judging = false;
  }).catch(()=>{ boardGlow('idle'); S.judging = false; });

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

  // Pre-eval the position NOW (during my thinking time) so the suspense beat
  // after I move only needs the AFTER eval. Cached in S.preMoveEval.
  S.preMoveEval = null;
  sfEvalLatest(S.chess.fen()).then(v => { S.preMoveEval = v; }).catch(()=>{});
}

// Server timer sync
function onServerTimer(msg) {
  S.timerVal = msg.value;
  updateTimerUI();
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
  try {
    const youEl = document.getElementById('cap-you');
    const oppEl = document.getElementById('cap-opp');
    if (youEl) youEl.innerHTML = (S.capturedMe||[]).map(p=>`<span>${(typeof GLYPH !== 'undefined' && GLYPH[p])||''}</span>`).join('');
    if (oppEl) oppEl.innerHTML = (S.capturedOpp||[]).map(p=>`<span>${(typeof GLYPH !== 'undefined' && GLYPH[p])||''}</span>`).join('');
  } catch(e) { console.error('updateCaptures error:', e); }
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

// EMERGENCY: always-works abandon button
window.abandonGame = function() {
  if (S.ws && S.ws.readyState === 1) {
    try { wsSend({ type: 'resign' }); } catch(e) {}
  }
  S.gameOver = true;
  stopLocalTimer();
  // Force back to lobby
  document.getElementById('result-modal').classList.remove('show');
  show('s-lobby');
  document.getElementById('btn-find').textContent = 'FIND MATCH';
  document.getElementById('btn-find').classList.remove('searching');
  document.getElementById('search-status').textContent = '';
};

// Wrap onGameOver with bulletproof error logging
const _originalOnGameOver = typeof onGameOver !== 'undefined' ? onGameOver : null;


// Auto-restart countdown on result modal
function startAutoRestartCountdown() {
  const btn = document.getElementById('btn-replay') || document.getElementById('m-again') || document.querySelector('[data-action="rematch"]');
  if (!btn) {
    console.log('[AUTORESTART] no rematch button found');
    return;
  }
  const originalText = btn.textContent;
  let seconds = 10;
  btn.textContent = originalText + ' (' + seconds + ')';
  btn.style.position = 'relative';
  btn.style.overflow = 'hidden';
  // Add progress bar to button
  let bar = btn.querySelector('.auto-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'auto-bar';
    bar.style.cssText = 'position:absolute;left:0;bottom:0;height:3px;width:100%;background:#FF7A1A;transition:width 1s linear;';
    btn.appendChild(bar);
  }
  bar.style.width = '100%';
  setTimeout(() => { bar.style.width = '0%'; }, 50);

  const interval = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearInterval(interval);
      btn.textContent = originalText;
      if (bar) bar.remove();
      // Auto-click rematch
      const modal = document.getElementById('result-modal');
      if (modal && modal.classList.contains('show')) {
        btn.click();
      }
    } else {
      btn.textContent = originalText + ' (' + seconds + ')';
    }
  }, 1000);

  // If user clicks anything, cancel the auto-restart
  const cancel = () => {
    clearInterval(interval);
    btn.textContent = originalText;
    if (bar) bar.remove();
    document.removeEventListener('click', cancel);
  };
  // Wait a moment then listen for any click
  setTimeout(() => document.addEventListener('click', cancel, { once: true }), 100);
}

// GAME OVER
// ══════════════════════════════════════════
function onGameOver(msg) {
  if (S._gameOverFired) { console.log('[GAME OVER] ignored duplicate'); return; }
  S._gameOverFired = true;
  console.log('[GAME OVER]', JSON.stringify(msg));
  S.gameOver = true;
  stopLocalTimer();
  // Helper that won't crash on missing elements
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setCls = (id, cls) => { const el = document.getElementById(id); if (el) el.className = cls; };

  const iWon = msg.winner === S.myColor;
  if (iWon) { sndWin(); S.streak++; flashB('fg'); flashOv('rgba(45,198,83,.2)'); }
  else { sndBlunder(); S.streak = 0; flashB('fr'); flashOv('rgba(230,57,70,.25)'); }

  const myRatings = msg.ratings && msg.ratings[S.myColor] ? msg.ratings[S.myColor] : {old: S.user?.rating||1200, new: S.user?.rating||1200, delta: 0};

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

  setEl('m-icon', iWon ? '👑' : '💀'); setEl('m-knight', iWon ? '👑' : '💀');
  setEl('m-title', iWon ? 'VICTORY' : 'DEFEATED');
  setCls('m-title', 'modal-title ' + (iWon?'win':'loss'));
  setEl('m-reason', msg.reason);

  // Add detailed blunder explanation if available
  const explainEl = document.getElementById('m-blunder-explain');
  if (explainEl) explainEl.remove();
  if (msg.blunderDetail) {
    const d = msg.blunderDetail;
    let html = '<div style="margin-top:16px;padding:14px 18px;background:rgba(225,29,46,0.08);border-left:3px solid #E11D2E;border-radius:4px;text-align:left;">';
    html += '<div style="font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:3px;color:#E11D2E;text-transform:uppercase;margin-bottom:8px;">Why you lost</div>';
    html += '<div style="font-size:16px;color:#F5F1EA;margin-bottom:4px;">You lost your <strong style="color:#FF7A1A;">' + d.lostPiece + '</strong> (' + d.lostValue + ' pts)</div>';
    html += '<div style="font-size:13px;color:#A1A1AA;">Captured by the ' + d.attackerPiece + ' on ' + d.attackerFrom + '</div>';
    if (!d.defended) {
      html += '<div style="font-size:13px;color:#A1A1AA;margin-top:6px;">Your piece was undefended.</div>';
    } else {
      html += '<div style="font-size:13px;color:#A1A1AA;margin-top:6px;">You could recapture for ' + d.recaptureValue + ' pts, but still lose ' + d.netLoss + ' material.</div>';
    }
    html += '</div>';
    const wrapper = document.createElement('div');
    wrapper.id = 'm-blunder-explain';
    wrapper.innerHTML = html;
    const reasonEl = document.getElementById('m-reason');
    if (reasonEl && reasonEl.parentNode) reasonEl.parentNode.insertBefore(wrapper, reasonEl.nextSibling);
  }
  setEl('m-r-old', myRatings.old);
  setEl('m-r-new', myRatings.new);
  setEl('m-r-delta', (myRatings.delta >= 0 ? '+' : '') + myRatings.delta);
  setCls('m-r-delta', 'r-delta ' + (myRatings.delta >= 0 ? 'up' : 'dn'));
  setEl('m-moves', myMoves.length);
  setEl('m-acc', acc + '%');
  setEl('m-time', typeof avgT === 'number' ? avgT+'s' : avgT);

  const noAdsEl = document.getElementById('no-ads-unlock');
  noAdsEl.style.display = (msg.noAdsUnlocked && msg.noAdsUnlocked[S.myColor]) ? 'block' : 'none';

  loadLeaderboard();
  // Delay modal so dramatic blunder reaction plays first
  setTimeout(() => {
    const modal = document.getElementById('result-modal');
    if (modal) {
      modal.style.transition = 'opacity 0.6s ease-in';
      modal.style.opacity = '0';
      modal.classList.add('show');
      setTimeout(() => { modal.style.opacity = '1'; }, 50);
    }
    startAutoRestartCountdown();
  }, 2800);
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
