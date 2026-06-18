/**
 * Sudden Death Chess — Frontend App
 * Connects to backend via WebSocket, uses Stockfish.js for real eval
 */

// ══════════════════════════════════════════
// AUDIO ENGINE
// ══════════════════════════════════════════
let actx;
function ga(){ if(!actx) actx=new(window.AudioContext||window.webkitAudioContext)(); return actx; }
let sfxBusNode;
function sfxBus(){ const c=ga(); if(!sfxBusNode){ sfxBusNode=c.createGain(); sfxBusNode.connect(c.destination); } return sfxBusNode; }
function tone(freq,type,dur,vol=.15,atk=.01,dec=.08){
  try{const c=ga(),o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(sfxBus());
  o.type=type;o.frequency.value=freq;const n=c.currentTime;
  g.gain.setValueAtTime(0,n);g.gain.linearRampToValueAtTime(vol,n+atk);
  g.gain.exponentialRampToValueAtTime(.001,n+atk+dec+dur);o.start(n);o.stop(n+atk+dec+dur+.05);}catch(e){}
}
const sndMove    = () => tone(440,'sine',.05,.1,.005,.04);
const sndCapture = () => tone(280,'sawtooth',.08,.14,.005,.07);
const sndGood    = () => { tone(660,'sine',.08,.16,.01,.1); setTimeout(()=>tone(880,'sine',.06,.12,.005,.08),80); };
const sndBrilliant = () => [523,659,784,1047,1319].forEach((f,i)=>setTimeout(()=>tone(f,'sine',.12,.16,.01,.1),i*70));
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
  timerVal: 5,
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

// Returns engine's best move for a FEN as {from,to} or null. Blunder replay only.
function sfBestMove(fen, movetime) {
  return new Promise((resolve) => {
    let worker;
    try { worker = new Worker('/js/stockfish.js'); }
    catch (e) { resolve(null); return; }
    let gotUciok = false, done = false;
    const fin = (mv) => { if (done) return; done = true; clearTimeout(ht); try { worker.terminate(); } catch(e){} resolve(mv); };
    worker.onmessage = (event) => {
      const msg = typeof event === 'string' ? event : event.data;
      if (!msg || typeof msg !== 'string') return;
      if (!gotUciok) {
        if (msg.startsWith('uciok')) { gotUciok = true; worker.postMessage('position fen ' + fen); worker.postMessage('go movetime ' + (movetime || 1000)); }
        return;
      }
      if (msg.startsWith('bestmove')) {
        const uci = msg.split(/\s+/)[1];
        if (uci && uci.length >= 4 && uci !== '(none)') fin({ from: uci.slice(0,2), to: uci.slice(2,4) });
        else fin(null);
      }
    };
    worker.onerror = () => fin(null);
    let tries = 0;
    const poll = setInterval(() => { if (gotUciok || done || tries > 25) { clearInterval(poll); return; } tries++; worker.postMessage('uci'); }, 250);
    const ht = setTimeout(() => { clearInterval(poll); fin(null); }, (movetime || 1000) + 2500);
  });
}

// ── Teachable blunder analysis: top-3 engine moves + plain-English reasons ──
function sfTopMoves(fen, n, movetime) {
  n = n || 3;
  return new Promise((resolve) => {
    let worker;
    try { worker = new Worker('/js/stockfish.js'); } catch (e) { resolve([]); return; }
    let gotUciok = false, done = false;
    const lines = {};
    const ht = setTimeout(() => { fin(); }, (movetime || 1200) + 2800);
    const fin = () => {
      if (done) return; done = true; clearTimeout(ht); clearInterval(poll);
      try { worker.terminate(); } catch (e) {}
      const arr = Object.keys(lines).map(k => lines[k]).sort((a, b) => a.idx - b.idx);
      resolve(arr.slice(0, n));
    };
    worker.onmessage = (event) => {
      const msg = typeof event === 'string' ? event : event.data;
      if (!msg || typeof msg !== 'string') return;
      if (!gotUciok) {
        if (msg.startsWith('uciok')) {
          gotUciok = true;
          worker.postMessage('setoption name MultiPV value ' + n);
          worker.postMessage('position fen ' + fen);
          worker.postMessage('go movetime ' + (movetime || 1200));
        }
        return;
      }
      if (msg.startsWith('info') && msg.indexOf(' multipv ') >= 0 && msg.indexOf(' pv ') >= 0) {
        const mp = msg.match(/ multipv (\d+)/);
        const pv = msg.match(/ pv (\w+)/);
        if (mp && pv && pv[1].length >= 4) {
          const idx = parseInt(mp[1]);
          const uci = pv[1];
          const mate = msg.match(/score mate (-?\d+)/);
          const cp = msg.match(/score cp (-?\d+)/);
          lines[idx] = { idx: idx, from: uci.slice(0, 2), to: uci.slice(2, 4),
            cp: cp ? parseInt(cp[1]) : null, mate: mate ? parseInt(mate[1]) : null };
        }
        return;
      }
      if (msg.startsWith('bestmove')) fin();
    };
    worker.onerror = () => fin();
    let tries = 0;
    var poll = setInterval(() => { if (gotUciok || done || tries > 25) { clearInterval(poll); return; } tries++; worker.postMessage('uci'); }, 250);
  });
}

function describeMove(fen, mv, rank) {
  const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  let san = mv.from + mv.to, piece = 'piece', cap = false, check = false, knight = false;
  try {
    const c = new Chess(fen);
    const pc = c.get(mv.from);
    if (pc) { piece = names[pc.type] || 'piece'; knight = pc.type === 'n'; }
    const target = c.get(mv.to);
    cap = !!(target && pc && target.color !== pc.color);
    const res = c.move({ from: mv.from, to: mv.to, promotion: 'q' });
    if (res) { san = res.san; check = /[+#]/.test(res.san); }
  } catch (e) {}
  const central = ['d4', 'e4', 'd5', 'e5', 'c4', 'f4', 'c5', 'f5'].indexOf(mv.to) >= 0;
  const lead = ['Strongest', 'Also strong', 'Solid'][rank] || 'Option';
  let why;
  if (typeof mv.mate === 'number') why = 'forces checkmate \u2014 the cleanest possible answer';
  else if (cap) why = 'wins material by capturing on ' + mv.to + ', keeping your piece safe';
  else if (check) why = 'checks the king, seizing the initiative instead of hanging a piece';
  else if (knight || piece === 'bishop') why = 'develops your ' + piece + ' to safety while keeping pressure';
  else if (central) why = 'takes the center and keeps every piece defended';
  else why = 'keeps the position solid \u2014 nothing left hanging';
  let evalTxt = '';
  if (typeof mv.mate === 'number') evalTxt = '';
  else if (typeof mv.cp === 'number') { const p = mv.cp / 100; evalTxt = ' (' + (p >= 0 ? '+' : '') + p.toFixed(1) + ')'; }
  return { san: san, lead: lead, knight: knight, why: why.charAt(0).toUpperCase() + why.slice(1) + evalTxt + '.' };
}

function clearTeachArrows() { const c = document.getElementById('teach-arrows'); if (c) c.remove(); }

function drawTeachArrow(fromSq, toSq, isKnight, color, rank) {
  const board = document.getElementById('board');
  if (!board) return;
  const rect = board.getBoundingClientRect();
  const cell = rect.width / 8;
  const flipped = S.myColor === 'black';
  const center = (sq) => {
    let file = sq.charCodeAt(0) - 97, rnk = parseInt(sq[1]) - 1;
    let col = flipped ? 7 - file : file, row = flipped ? rnk : 7 - rnk;
    return { x: col * cell + cell / 2, y: row * cell + cell / 2 };
  };
  const a = center(fromSq), b = center(toSq);
  let pathD;
  if (isKnight) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const bend = Math.abs(dx) > Math.abs(dy) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    pathD = 'M ' + a.x + ' ' + a.y + ' L ' + bend.x + ' ' + bend.y + ' L ' + b.x + ' ' + b.y;
  } else {
    pathD = 'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y;
  }
  let c = document.getElementById('teach-arrows');
  if (!c) {
    c = document.createElement('div');
    c.id = 'teach-arrows';
    c.style.cssText = 'position:absolute;left:0;top:0;width:' + rect.width + 'px;height:' + rect.height + 'px;pointer-events:none;z-index:50;';
    board.parentElement.appendChild(c);
  }
  const mid = 'tah' + rank;
  c.insertAdjacentHTML('beforeend',
    '<svg width="' + rect.width + '" height="' + rect.height + '" style="position:absolute;left:0;top:0;overflow:visible">' +
    '<defs><marker id="' + mid + '" markerWidth="5" markerHeight="5" refX="3" refY="2.5" orient="auto">' +
    '<path d="M0,0 L5,2.5 L0,5 Z" fill="' + color + '"/></marker></defs>' +
    '<path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="' + (cell * 0.13).toFixed(1) +
    '" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#' + mid + ')" opacity="0.95"/>' +
    '<circle cx="' + a.x + '" cy="' + a.y + '" r="' + (cell * 0.17).toFixed(1) + '" fill="' + color + '" stroke="#fff" stroke-width="2"/>' +
    '<text x="' + a.x + '" y="' + (a.y + cell * 0.075).toFixed(1) + '" text-anchor="middle" font-family="Antonio,sans-serif" font-size="' + (cell * 0.26).toFixed(1) + '" font-weight="700" fill="#fff">' + rank + '</text>' +
    '</svg>');
}

function teachPanelStyle() {
  if (document.getElementById('teach-style')) return;
  const st = document.createElement('style'); st.id = 'teach-style';
  st.textContent =
    "#teach-panel{position:fixed;right:20px;top:50%;transform:translateY(-50%);width:300px;max-width:42vw;z-index:1200;background:#FFFCF5;color:#2A2118;border-radius:16px;padding:16px 18px;box-shadow:0 16px 44px rgba(0,0,0,.5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;animation:tpIn .4s cubic-bezier(.18,.9,.32,1.4);}" +
    ".tp-head{font-family:Antonio,sans-serif;font-weight:700;font-size:17px;letter-spacing:.5px;color:#E8722A;margin-bottom:10px;}" +
    ".tp-body{font-size:14px;line-height:1.5;}.tp-body strong{color:#C0392B;}" +
    ".tp-move{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid #efe7d8;}.tp-move:first-of-type{border-top:none;}" +
    ".tp-badge{flex:none;width:22px;height:22px;border-radius:50%;color:#fff;font-family:Antonio,sans-serif;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;margin-top:1px;}" +
    ".tp-san{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:15px;}" +
    ".tp-lead{font-size:11px;color:#9a8f7d;font-family:Antonio,sans-serif;letter-spacing:.5px;margin-left:4px;}" +
    ".tp-why{font-size:12.5px;line-height:1.4;color:#4a4136;margin-top:2px;}" +
    "@keyframes tpIn{from{opacity:0;transform:translateY(-50%) translateX(22px);}to{opacity:1;transform:translateY(-50%) translateX(0);}}" +
    "@media(max-width:860px){#teach-panel{right:50%;top:auto;bottom:14px;transform:translateX(50%);width:min(92vw,360px);}}";
  document.head.appendChild(st);
}

function hideTeachPanel() { const p = document.getElementById('teach-panel'); if (p) p.remove(); }

function showWhyPanel(d, square) {
  teachPanelStyle(); hideTeachPanel();
  let body;
  if (d && d.positional) {
    body = 'That move handed over about <strong>' + d.netLoss + '</strong> pawns of advantage \u2014 exactly the kind of slip the engine pounces on.';
  } else if (d) {
    body = 'Your <strong>' + d.lostPiece + '</strong> on <strong>' + square + '</strong> was left hanging \u2014 the ' + d.attackerPiece + ' from ' + d.attackerFrom + ' could just take it.';
    if (d.defended) body += ' Even recapturing, you come out <strong>' + d.netLoss + '</strong> behind.';
    else body += ' And nothing was guarding it.';
  } else {
    body = 'That move gave up too much material.';
  }
  const p = document.createElement('div');
  p.id = 'teach-panel'; p.className = 'tp-why';
  p.innerHTML = '<div class="tp-head">\uD83D\uDCA1 Why that lost</div><div class="tp-body">' + body + '</div>';
  document.body.appendChild(p);
}

function showBetterPanel(items) {
  teachPanelStyle(); hideTeachPanel();
  const rows = items.map((it) =>
    '<div class="tp-move"><span class="tp-badge" style="background:' + it.color + '">' + it.rank + '</span>' +
    '<div><div><span class="tp-san">' + it.san + '</span><span class="tp-lead">' + it.lead + '</span></div>' +
    '<div class="tp-why">' + it.why + '</div></div></div>').join('');
  const p = document.createElement('div');
  p.id = 'teach-panel'; p.className = 'tp-better';
  p.innerHTML = '<div class="tp-head">\u2705 What would\u2019ve worked</div>' + rows;
  document.body.appendChild(p);
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
    } else if (S.guestPending) {
      wsSend({ type: 'guest' });
    }
    // Keepalive ping every 25s (clear any previous one so reconnects don't stack)
    if (S._pingInterval) clearInterval(S._pingInterval);
    S._pingInterval = setInterval(() => wsSend({ type: 'ping' }), 25000);
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
    case 'challenge_created': return onChallengeCreated(msg);
    case 'challenge_invalid': return onChallengeInvalid();
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
    show('s-lobby');
    toast(`Welcome${signupMode ? '' : ' back'}, ${username}!`);
  } catch(e) {
    errEl.textContent = 'Connection error. Try again.';
  }
}

// ── INSTANT GUEST PLAY ───────────────────
function showSearchingOverlay() {
  let ov = document.getElementById('searching-overlay');
  if (ov) ov.remove();
  if (!document.getElementById('sdc-spin-kf')) {
    const st = document.createElement('style'); st.id = 'sdc-spin-kf';
    st.textContent = '@keyframes sdcSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }
  ov = document.createElement('div');
  ov.id = 'searching-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:870;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(14,17,22,0.92);backdrop-filter:blur(10px)';
  ov.innerHTML = '<div style="width:54px;height:54px;border:4px solid rgba(255,122,26,0.25);border-top-color:#FF7A1A;border-radius:50%;animation:sdcSpin .8s linear infinite"></div>' +
    '<div style="margin-top:26px;font-family:Antonio,sans-serif;font-size:26px;font-weight:700;color:#F5F1EA;letter-spacing:1px">Searching for an opponent<span class="dot-anim"></span></div>' +
    '<div style="margin-top:8px;font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:3px;color:#52525B;text-transform:uppercase">Matching you by rating</div>';
  document.body.appendChild(ov);
}
function hideSearchingOverlay() {
  const ov = document.getElementById('searching-overlay'); if (ov) ov.remove();
}

// ── TEXTURE PACKS (premium board themes) ─────────────────────────────────
const TEXTURE_PACKS = [
  { id:'main',     name:'Main',     light:'#E8D7B5', dark:'#3A2E26' },
  { id:'midnight', name:'Midnight', light:'#5A6B8C', dark:'#1B2433' },
  { id:'emerald',  name:'Emerald',  light:'#E9EFD0', dark:'#3C6B4A' },
  { id:'crimson',  name:'Crimson',  light:'#E7C9C0', dark:'#5E1F22' },
  { id:'ice',      name:'Ice',      light:'#EAF4FB', dark:'#7FA7C9' },
  { id:'sunset',   name:'Sunset',   light:'#F7D9A8', dark:'#7A3B5E' },
  { id:'mono',     name:'Mono',     light:'#D9D9D9', dark:'#4A4A4A' },
  { id:'royal',    name:'Royal',    light:'#EBD9A8', dark:'#4B2E83' },
];
function applyTexturePack(id) {
  const p = TEXTURE_PACKS.find(t => t.id === id) || TEXTURE_PACKS[0];
  document.documentElement.style.setProperty('--board-light', p.light);
  document.documentElement.style.setProperty('--board-dark', p.dark);
  S.texture = p.id;
  try { localStorage.setItem('sdc_texture', p.id); } catch(e) {}
}
function loadTexturePack() {
  let id = 'main';
  try { id = localStorage.getItem('sdc_texture') || 'main'; } catch(e) {}
  if (!(S.user && S.user.is_premium)) id = 'main';   // packs are premium-only
  applyTexturePack(id);
}
function showTexturePacks() {
  if (!(S.user && S.user.is_premium)) { showPremium(); return; }
  let ov = document.getElementById('texture-overlay'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'texture-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2000;overflow-y:auto;background:rgba(14,17,22,0.96);display:flex;align-items:flex-start;justify-content:center;padding:40px 20px';
  const cur = S.texture || 'main';
  const cards = TEXTURE_PACKS.map(function(p){
    const sel = p.id === cur;
    let grid = '';
    for (let i = 0; i < 16; i++) { const r = Math.floor(i/4), c = i%4; const dark = (r+c)%2 === 1; grid += '<div style="background:' + (dark?p.dark:p.light) + '"></div>'; }
    return '<div data-pack="' + p.id + '" class="tex-card" style="cursor:pointer;border-radius:10px;overflow:hidden;border:2px solid ' + (sel?'#F5C518':'rgba(255,255,255,0.1)') + ';background:#191D24">' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(4,1fr);aspect-ratio:1">' + grid + '</div>' +
      '<div style="padding:8px 10px;display:flex;align-items:center;justify-content:space-between">' +
        '<span style="font-family:Antonio,sans-serif;font-size:16px;font-weight:700;color:#F5F1EA">' + p.name + '</span>' +
        (sel ? '<span style="font-family:JetBrains Mono,monospace;font-size:10px;color:#F5C518;letter-spacing:1px">ACTIVE</span>' : '') +
      '</div></div>';
  }).join('');
  ov.innerHTML = '<div style="width:100%;max-width:520px">' +
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px">' +
      '<div><div style="font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:4px;color:#F5C518;text-transform:uppercase">Premium</div>' +
      '<h1 style="font-family:Antonio,sans-serif;font-size:32px;font-weight:700;color:#F5F1EA;margin:2px 0 0">Texture Packs</h1></div>' +
      '<button id="tex-close" style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.08);border:none;color:#F5F1EA;font-size:20px;cursor:pointer">\u00d7</button>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' + cards + '</div>' +
  '</div>';
  document.body.appendChild(ov);
  document.getElementById('tex-close').onclick = function(){ ov.remove(); };
  ov.querySelectorAll('.tex-card').forEach(function(card){
    card.onclick = function(){ applyTexturePack(card.getAttribute('data-pack')); showTexturePacks(); };
  });
}

// ── LOBBY BUTTONS (Play a Friend + Texture Packs) ────────────────────────
function ensureLobbyButtons() {
  const findBtn = document.getElementById('btn-find');
  if (!findBtn || !findBtn.parentElement) return;
  const container = findBtn.parentElement;
  if (!document.getElementById('btn-friend')) {
    const fb = document.createElement('button');
    fb.id = 'btn-friend'; fb.textContent = '\uD83E\uDD1D PLAY A FRIEND';
    fb.style.cssText = 'width:100%;max-width:340px;background:transparent;color:#34D399;border:1px solid #34D399;padding:13px;font-family:Antonio,sans-serif;font-size:18px;font-weight:700;letter-spacing:2px;cursor:pointer;border-radius:6px';
    fb.onmouseenter = function(){ fb.style.background = 'rgba(52,211,153,0.08)'; };
    fb.onmouseleave = function(){ fb.style.background = 'transparent'; };
    fb.onclick = createChallenge;
    container.appendChild(fb);
  }
  const tex = document.getElementById('btn-texture');
  if (S.user && S.user.is_premium) {
    if (!tex) {
      const tb = document.createElement('button');
      tb.id = 'btn-texture'; tb.textContent = '\uD83C\uDFA8 TEXTURE PACKS';
      tb.style.cssText = 'width:100%;max-width:340px;background:transparent;color:#F5C518;border:1px solid #F5C518;padding:13px;font-family:Antonio,sans-serif;font-size:18px;font-weight:700;letter-spacing:2px;cursor:pointer;border-radius:6px';
      tb.onmouseenter = function(){ tb.style.background = 'rgba(245,197,24,0.08)'; };
      tb.onmouseleave = function(){ tb.style.background = 'transparent'; };
      tb.onclick = showTexturePacks;
      container.appendChild(tb);
    }
  } else if (tex) { tex.remove(); }
}

// ── PLAY A FRIEND (client) ───────────────────────────────────────────────
function createChallenge() {
  if (!S.token && !(S.user && S.user.guest)) {
    S.guestPending = true; S._pendingCreateChallenge = true;
    if (S.ws && S.ws.readyState === WebSocket.OPEN) wsSend({ type: 'guest' });
    return;
  }
  wsSend({ type: 'create_challenge' });
  toast('Creating your invite\u2026');
}
function onChallengeCreated(msg) {
  const link = location.origin + '/?challenge=' + msg.code;
  let ov = document.getElementById('challenge-overlay'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'challenge-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(14,17,22,0.95)';
  ov.innerHTML = '<div style="width:100%;max-width:440px;text-align:center">' +
    '<div style="font-size:48px">\uD83E\uDD1D</div>' +
    '<h1 style="font-family:Antonio,sans-serif;font-size:32px;font-weight:700;color:#F5F1EA;margin:8px 0 4px">Invite a Friend</h1>' +
    '<p style="font-size:14px;color:#A1A1AA;margin-bottom:18px">Send this link. The game starts the moment they open it.</p>' +
    '<div style="display:flex;gap:8px;margin-bottom:14px">' +
      '<input id="chal-link" readonly value="' + link + '" style="flex:1;min-width:0;background:#191D24;border:1px solid #3D4A5C;border-radius:6px;color:#F5F1EA;padding:12px;font-family:JetBrains Mono,monospace;font-size:12px"/>' +
      '<button id="chal-copy" style="background:linear-gradient(135deg,#FF7A1A,#F5C518);color:#0E1116;border:none;border-radius:6px;padding:0 16px;font-family:Antonio,sans-serif;font-size:15px;font-weight:700;cursor:pointer">COPY</button>' +
    '</div>' +
    '<div style="font-family:JetBrains Mono,monospace;font-size:12px;color:#52525B;letter-spacing:2px">Waiting for your friend to join<span class="dot-anim"></span></div>' +
    '<div id="chal-cancel" style="margin-top:22px;font-size:13px;color:#A1A1AA;cursor:pointer;text-decoration:underline">Cancel</div>' +
  '</div>';
  document.body.appendChild(ov);
  const copyBtn = document.getElementById('chal-copy');
  copyBtn.onclick = function(){
    const i = document.getElementById('chal-link'); try { i.select(); document.execCommand('copy'); } catch(e) {}
    try { if (navigator.clipboard) navigator.clipboard.writeText(link); } catch(e) {}
    copyBtn.textContent = 'COPIED'; setTimeout(function(){ copyBtn.textContent = 'COPY'; }, 1500);
  };
  document.getElementById('chal-cancel').onclick = function(){ ov.remove(); try { wsSend({ type: 'cancel_challenge' }); } catch(e) {} };
}
function onChallengeInvalid() {
  hideSearchingOverlay();
  const ov = document.getElementById('challenge-overlay'); if (ov) ov.remove();
  toast('That invite link expired or was already used.');
}

function playAsGuest() {
  S.guestPending = true;
  S.pendingFindMatch = true;
  showSearchingOverlay();
  if (S.ws && S.ws.readyState === WebSocket.OPEN) wsSend({ type: 'guest' });
  // else: connectWS onopen fires the guest handshake once the socket opens
}

function injectGuestButton() {
  const card = document.querySelector('#s-login .login-card');
  if (!card || document.getElementById('btn-guest')) return;
  const label = document.getElementById('lm-label');
  if (!label) return;
  const b = document.createElement('button');
  b.id = 'btn-guest';
  b.textContent = '\u25B6 PLAY NOW \u2014 NO SIGNUP';
  b.style.cssText = 'width:100%;background:linear-gradient(135deg,#FF7A1A,#F5C518);color:#0E1116;border:none;padding:16px;font-family:Antonio,sans-serif;font-size:22px;font-weight:700;letter-spacing:2px;cursor:pointer;border-radius:6px;box-shadow:0 0 28px rgba(255,122,26,.35);margin-bottom:4px';
  b.onmouseenter = () => { b.style.filter = 'brightness(1.07)'; };
  b.onmouseleave = () => { b.style.filter = 'none'; };
  b.onclick = playAsGuest;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;align-items:center;gap:10px;margin:16px 0 4px;color:#52525B;font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:2px';
  div.innerHTML = '<span style=\"flex:1;height:1px;background:#2A2F37\"></span>OR SIGN IN TO SAVE PROGRESS<span style=\"flex:1;height:1px;background:#2A2F37\"></span>';
  card.insertBefore(b, label);
  card.insertBefore(div, label);
}
injectGuestButton();

function onAuthed(user) {
  S.user = user;
  S.ratingHistory = [user.rating];
  updateNavUser();
  if (user.no_ads || user.is_premium) hideAds();
  ensureLobbyButtons();
  loadTexturePack();
  if (S.joinChallenge) { wsSend({ type: 'join_challenge', code: S.joinChallenge }); S.joinChallenge = null; }
  else if (S._pendingCreateChallenge) { S._pendingCreateChallenge = false; wsSend({ type: 'create_challenge' }); }
  else if (S.pendingFindMatch) {
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

document.getElementById('btn-logout').addEventListener('click', logout);
function logout() {
  try { wsSend({ type: 'cancel' }); } catch (e) {}
  if (S.gameId && !S.gameOver) { try { wsSend({ type: 'resign' }); } catch (e) {} }
  stopLocalTimer();
  localStorage.removeItem('sdc_token');
  S.token = null; S.user = null; S.ratingHistory = [];
  S.gameId = null; S.gameOver = true; searching = false;
  const findBtn = document.getElementById('btn-find');
  if (findBtn) { findBtn.classList.remove('searching'); findBtn.textContent = 'FIND MATCH'; }
  const ss = document.getElementById('search-status'); if (ss) ss.innerHTML = '';
  const modal = document.getElementById('result-modal'); if (modal) modal.classList.remove('show');
  const errEl = document.getElementById('err-msg'); if (errEl) errEl.textContent = '';
  ['inp-user','inp-pass','inp-confirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  show('s-login');
  toast('Logged out.');
}

// Live online counter (simulated with slight noise for now)
let onlineBase = 800;
setInterval(() => {
  onlineBase += Math.floor(Math.random() * 7) - 3;
  onlineBase = Math.max(400, onlineBase);
  document.getElementById('stat-online').textContent = onlineBase;
}, 4000);

// ══════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════
async function showProfile() {
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
  if (u.is_premium) {
    adsEl.textContent = '✓ Premium — ads disabled.';
    adsEl.className = 'ads-status no-ads';
  } else {
    adsEl.textContent = 'Go Premium to remove ads and unlock extras.';
    adsEl.className = 'ads-status';
  }

  // ── Premium crown + diamond badge ──
  (function(){
    const av = document.getElementById('prof-avatar');
    if (av) {
      av.style.position = 'relative';
      if (u.is_premium) {
        const _vip = u.vip;
        av.style.boxShadow = _vip
          ? '0 0 0 3px #B14BE8, 0 0 24px rgba(177,75,232,0.65)'
          : '0 0 0 3px #F5C518, 0 0 18px rgba(245,197,24,0.55)';
        if (_vip && !document.getElementById('vip-crown-style')) {
          const vs = document.createElement('style'); vs.id = 'vip-crown-style';
          vs.textContent = '@keyframes vipCrown{0%,100%{transform:translateX(-50%) translateY(0) rotate(-7deg)}50%{transform:translateX(-50%) translateY(-4px) rotate(7deg)}}@keyframes vipGlow{0%,100%{filter:drop-shadow(0 0 8px rgba(245,197,24,.9))}50%{filter:drop-shadow(0 0 16px rgba(177,75,232,1))}}';
          document.head.appendChild(vs);
        }
        let cr = document.getElementById('prof-avatar-crown');
        if (!cr) { cr = document.createElement('div'); cr.id = 'prof-avatar-crown'; cr.textContent = '\uD83D\uDC51'; av.appendChild(cr); }
        cr.style.cssText = _vip
          ? 'position:absolute;top:-19px;left:50%;transform:translateX(-50%);font-size:30px;animation:vipCrown 2.4s ease-in-out infinite, vipGlow 2.4s ease-in-out infinite'
          : 'position:absolute;top:-15px;left:50%;transform:translateX(-50%);font-size:24px;filter:drop-shadow(0 0 7px rgba(245,197,24,0.85))';
      } else {
        av.style.boxShadow = '';
        const c = document.getElementById('prof-avatar-crown'); if (c) c.remove();
      }
    }
    const nameEl = document.getElementById('prof-name');
    let badge = document.getElementById('prof-premium-badge');
    if (u.is_premium && nameEl) {
      if (!badge) { badge = document.createElement('div'); badge.id = 'prof-premium-badge'; nameEl.insertAdjacentElement('afterend', badge); }
      badge.innerHTML = u.vip
        ? '<span style="display:inline-flex;align-items:center;gap:7px;margin-top:8px;padding:5px 14px;border-radius:20px;background:linear-gradient(135deg,rgba(177,75,232,0.28),rgba(245,197,24,0.22));border:1px solid rgba(177,75,232,0.6);font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:2px;color:#EAC9FF;text-transform:uppercase">\u2726 VIP \u2726</span>'
        : '<span style="display:inline-flex;align-items:center;gap:7px;margin-top:8px;padding:5px 14px;border-radius:20px;background:linear-gradient(135deg,rgba(245,197,24,0.18),rgba(255,122,26,0.18));border:1px solid rgba(245,197,24,0.5);font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:2px;color:#F5C518;text-transform:uppercase">\uD83D\uDC51 Premium \uD83D\uDC8E</span>';
    } else if (badge) { badge.remove(); }
  })();

  show('s-profile');
  await loadProfileGames(u.username);
}

async function loadProfileGames(username) {
  const listEl = document.getElementById('games-list');
  try {
    const res = await fetch('/api/users/' + encodeURIComponent(username) + '/games?limit=30');
    const games = res.ok ? await res.json() : [];
    if (games.length) {
      const curve = [games[0].ratingBefore];
      games.forEach(g => { if (typeof g.ratingAfter === 'number') curve.push(g.ratingAfter); });
      S.ratingHistory = curve;
    }
    drawChart();
    if (listEl) {
      if (!games.length) {
        listEl.innerHTML = '<div style="color:#52525B;font-size:12px;padding:8px 0">No games yet \u2014 go win some.</div>';
      } else {
        listEl.innerHTML = games.slice().reverse().map(g => {
          const win = g.result === 'win', draw = g.result === 'draw';
          const col = draw ? '#A1A1AA' : (win ? '#34D399' : '#E11D2E');
          const tag = draw ? 'DRAW' : (win ? 'WIN' : 'LOSS');
          const sign = (g.delta >= 0 ? '+' : '');
          const when = g.date ? String(g.date).split(' ')[0] : '';
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-left:3px solid ' + col + ';background:rgba(255,255,255,0.02);border-radius:4px;margin-bottom:6px;">' +
            '<div style="display:flex;flex-direction:column;gap:2px">' +
              '<span style="font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:2px;color:' + col + '">' + tag + '</span>' +
              '<span style="font-size:13px;color:#F5F1EA">vs ' + (g.opponent || 'Opponent') + ' <span style="color:#52525B">(' + (g.opponentRating || '?') + ')</span></span>' +
              '<span style="font-size:11px;color:#52525B">' + (g.endReason || '') + '</span>' +
            '</div>' +
            '<div style="text-align:right">' +
              '<div style="font-family:JetBrains Mono,monospace;font-size:14px;color:' + col + '">' + sign + (g.delta == null ? 0 : g.delta) + '</div>' +
              '<div style="font-size:11px;color:#52525B">' + (g.ratingAfter || '') + '</div>' +
              '<div style="font-size:10px;color:#3D4A5C">' + when + '</div>' +
            '</div>' +
          '</div>';
        }).join('');
      }
    }
  } catch (e) {
    if (listEl) listEl.innerHTML = '<div style="color:#52525B;font-size:12px">Could not load games.</div>';
  }
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
  hideSearchingOverlay();
  { const co = document.getElementById('challenge-overlay'); if (co) co.remove(); }
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
  ensureRecordButton();
  startPreGameCountdown(msg.color === 'white');
}

// ══════════════════════════════════════════
// CHESS BOARD
// ══════════════════════════════════════════

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
      wsSend({ type: 'ready' });   // tell the server we can move now -> it starts the clock
      startLocalTimer();
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

// Spawn the particle/shockwave explosion on the blundered square.
// Tiered good-move celebration. delta = how much the move gained (pawns).
function goodEffect(toSquare, delta, wasCapture) {
  fx2Style();
  const sq = document.querySelector('#board [data-sq="' + toSquare + '"]');
  const c = fx2SqCenter(toSquare);
  if (delta >= 2.0) {
    sndBrilliant();
    const labels = ['BRILLIANT','GENIUS','MASTERFUL','SPECTACULAR','INSANE','UNREAL'];
    const label = labels[(Math.random()*labels.length)|0];
    const v = ['edge','fireworks','rays','stars','flash','combo'][(Math.random()*6)|0];
    if (v === 'edge') { const g = document.createElement('div'); g.className = 'brilliant-edge'; document.body.appendChild(g); if (sq) sparkle(sq, 16, 'gold'); setTimeout(() => g.remove(), 1600); }
    else if (v === 'fireworks') bfx2Fireworks(3, true);
    else if (v === 'rays') fx2Rays(c.x, c.y, '#F5C518');
    else if (v === 'stars') bfx2StarBurst(c.x, c.y, 18);
    else if (v === 'flash') { fx2Flash('245,197,24', 0.45); bfx2Sparks(c.x, c.y, '#F5C518', 26); }
    else { bfx2Sparks(c.x, c.y, '#F5C518', 20); bfx2StarBurst(c.x, c.y, 8); }
    fx2BrilliantText(label, wasCapture ? 'What a strike' : 'Pure precision');
  } else {
    sndGood();
    const labels = wasCapture ? ['NICE TAKE','CLEAN HIT','SNATCHED'] : ['GOOD MOVE','SOLID','SHARP','SLICK'];
    const label = labels[(Math.random()*labels.length)|0];
    const v = ['sparkle','ring','plus','sparks'][(Math.random()*4)|0];
    if (v === 'sparkle' && sq) sparkle(sq, 9, 'green');
    else if (v === 'ring') fx2Ring(c.x, c.y, c.cell, '52,211,153');
    else if (v === 'plus') fx2FloatText(c.x, c.y, '+' + (delta > 0 ? delta.toFixed(1) : '0.0'), '#34D399');
    else bfx2Sparks(c.x, c.y, '#34D399', 14);
    fx2GoodText(label);
  }
}

// Spawn rising sparkle particles off a square.
function sparkle(sq, count, color) {
  const wrap = document.createElement('div');
  wrap.className = 'sparkle-wrap';
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'sparkle ' + color;
    s.style.left = (Math.random() * 100) + '%';
    s.style.setProperty('--sx', ((Math.random() * 2 - 1) * 40).toFixed(0) + 'px');
    s.style.setProperty('--sup', (40 + Math.random() * 60).toFixed(0) + 'px');
    s.style.setProperty('--sdel', (Math.random() * 0.3).toFixed(2) + 's');
    s.style.setProperty('--ssz', (3 + Math.random() * 4).toFixed(1) + 'px');
    wrap.appendChild(s);
  }
  sq.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1500);
}

// Randomly selects one of five blunder effects on the blundered square.
function bbInjectStyle() {
  if (document.getElementById('bb-style')) return;
  const st = document.createElement('style'); st.id = 'bb-style';
  st.textContent =
    '#blunder-bubble{position:fixed;z-index:1200;width:240px;background:#FFFCF5;color:#2A2118;border-radius:14px;padding:12px 15px;box-shadow:0 12px 34px rgba(0,0,0,.45);transition:opacity .35s,transform .35s;}' +
    '#blunder-bubble.bb-out{opacity:0;transform:translateY(-6px) scale(.96);}' +
    '#blunder-bubble .bb-head{font-family:Antonio,sans-serif;font-weight:700;font-size:15px;letter-spacing:.5px;color:#E8722A;margin-bottom:5px;}' +
    '#blunder-bubble .bb-body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:13px;line-height:1.45;}' +
    '#blunder-bubble .bb-body strong{color:#C0392B;}' +
    '#blunder-bubble .bb-tail{position:absolute;bottom:-8px;width:16px;height:16px;background:#FFFCF5;transform:rotate(45deg);}' +
    '#blunder-bubble.bb-below .bb-tail{bottom:auto;top:-8px;}' +
    '@keyframes bbPop{from{opacity:0;transform:translateY(8px) scale(.9);}to{opacity:1;transform:translateY(0) scale(1);}}';
  document.head.appendChild(st);
}
function showBlunderBubble(square, d) {
  bbInjectStyle();
  const old = document.getElementById('blunder-bubble'); if (old) old.remove();
  const sqEl = document.querySelector('#board [data-sq="' + square + '"]');
  if (!sqEl) return;
  const r = sqEl.getBoundingClientRect();
  let body;
  if (d && d.positional) {
    body = 'That move handed over about <strong>' + d.netLoss + '</strong> pawns of advantage \u2014 just the kind of slip the engine pounces on.';
  } else if (d) {
    body = 'Your <strong>' + d.lostPiece + '</strong> on <strong>' + square + '</strong> was left hanging \u2014 the ' + d.attackerPiece + ' from ' + d.attackerFrom + ' could just take it.';
    if (d.defended) body += ' Even taking back, you\u2019d come out <strong>' + d.netLoss + '</strong> behind.';
    else body += ' And nothing was guarding it!';
  } else {
    body = 'That move gave up too much material.';
  }
  const bub = document.createElement('div');
  bub.id = 'blunder-bubble';
  bub.style.animation = 'bbPop .35s cubic-bezier(.18,.9,.32,1.4)';
  bub.innerHTML = '<div class="bb-head">\uD83D\uDCA1 Here\u2019s what happened</div><div class="bb-body">' + body + '</div><div class="bb-tail"></div>';
  document.body.appendChild(bub);
  const bw = bub.offsetWidth || 240;
  let left = r.left + r.width / 2 - bw / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - bw - 10));
  const bh = bub.offsetHeight;
  let top = r.top - bh - 14; let below = false;
  if (top < 10) { top = r.bottom + 14; below = true; }
  bub.style.left = left + 'px'; bub.style.top = top + 'px';
  if (below) bub.classList.add('bb-below');
  const tail = bub.querySelector('.bb-tail');
  if (tail) tail.style.left = ((r.left + r.width / 2) - left - 8) + 'px';
  setTimeout(() => { bub.classList.add('bb-out'); setTimeout(() => { if (bub.parentNode) bub.remove(); }, 400); }, 6500);
}
function blunderEffect(toSquare) {
  const fx = ['shatter','melt','blood','tilt','implode','glitch','quake','lightning','ink','freeze','vortex','static'];
  const pick = fx[Math.floor(Math.random() * fx.length)];
  console.log('[BLUNDER FX]', pick);
  switch (pick) {
    case 'shatter':   return explodePiece(toSquare);
    case 'melt':      return fxMelt(toSquare);
    case 'blood':     return fxBlood(toSquare);
    case 'tilt':      return fxTilt(toSquare);
    case 'implode':   return fxImplode(toSquare);
    case 'glitch':    return fxGlitch(toSquare);
    case 'quake':     return fxQuake(toSquare);
    case 'lightning': return fxLightning(toSquare);
    case 'ink':       return fxInk(toSquare);
    case 'freeze':    return fxFreeze(toSquare);
    case 'vortex':    return fxVortex(toSquare);
    case 'static':    return fxStatic(toSquare);
  }
}

function fxSquareEl(sq) { return document.querySelector('#board [data-sq="' + sq + '"]'); }

// MELT — the piece drips/dissolves into particles and fades.
function fxMelt(toSquare) {
  const sq = fxSquareEl(toSquare); if (!sq) return;
  const piece = sq.querySelector('img.piece');
  if (piece) piece.classList.add('melting-piece');
  const drips = document.createElement('div');
  drips.className = 'melt-drips';
  for (let i = 0; i < 7; i++) {
    const d = document.createElement('div');
    d.className = 'melt-drip';
    d.style.left = (10 + Math.random() * 80) + '%';
    d.style.setProperty('--mdelay', (Math.random() * 0.25).toFixed(2) + 's');
    d.style.setProperty('--mh', (40 + Math.random() * 50).toFixed(0) + '%');
    drips.appendChild(d);
  }
  sq.appendChild(drips);
  setTimeout(() => { drips.remove(); if (piece) piece.classList.remove('melting-piece'); }, 1300);
}

// BLOOD — red seeps from the square and spreads to neighbors.
function fxBlood(toSquare) {
  const sq = fxSquareEl(toSquare); if (!sq) return;
  const pool = document.createElement('div');
  pool.className = 'blood-pool';
  sq.appendChild(pool);
  // spread to up to 4 neighbors
  const file = toSquare.charCodeAt(0), rank = parseInt(toSquare[1]);
  const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];
  neighbors.forEach(([df, dr], i) => {
    const nf = String.fromCharCode(file + df), nr = rank + dr;
    if (nf < 'a' || nf > 'h' || nr < 1 || nr > 8) return;
    const nsq = fxSquareEl(nf + nr);
    if (!nsq) return;
    const sp = document.createElement('div');
    sp.className = 'blood-spread';
    sp.style.setProperty('--bdelay', (0.15 + i * 0.08).toFixed(2) + 's');
    nsq.appendChild(sp);
    setTimeout(() => sp.remove(), 2000);
  });
  setTimeout(() => pool.remove(), 2000);
}

// TILT — whole board tips in 3D and pieces slide off.
function fxTilt(toSquare) {
  const board = document.getElementById('board');
  if (!board) return;
  board.classList.add('board-tilt');
  board.querySelectorAll('img.piece').forEach((pc, i) => {
    pc.style.setProperty('--slidex', ((Math.random() * 2 - 1) * 60).toFixed(0) + 'px');
    pc.style.setProperty('--sdelay', (Math.random() * 0.3).toFixed(2) + 's');
    pc.classList.add('piece-sliding');
  });
  setTimeout(() => {
    board.classList.remove('board-tilt');
    board.querySelectorAll('img.piece').forEach(pc => {
      pc.classList.remove('piece-sliding');
      pc.style.removeProperty('--slidex'); pc.style.removeProperty('--sdelay');
    });
  }, 1500);
}

// IMPLODE — the square caves in, pulling neighbors toward it (black hole).
function fxImplode(toSquare) {
  const sq = fxSquareEl(toSquare); if (!sq) return;
  const hole = document.createElement('div');
  hole.className = 'implode-hole';
  sq.appendChild(hole);
  const piece = sq.querySelector('img.piece');
  if (piece) piece.classList.add('imploding-piece');
  const file = toSquare.charCodeAt(0), rank = parseInt(toSquare[1]);
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    if (df === 0 && dr === 0) continue;
    const nf = String.fromCharCode(file + df), nr = rank + dr;
    if (nf < 'a' || nf > 'h' || nr < 1 || nr > 8) continue;
    const nsq = fxSquareEl(nf + nr);
    const npc = nsq && nsq.querySelector('img.piece');
    if (npc) {
      npc.style.setProperty('--pullx', (-df * 40).toFixed(0) + 'px');
      npc.style.setProperty('--pully', (dr * 40).toFixed(0) + 'px');
      npc.classList.add('pulled-piece');
    }
  }
  setTimeout(() => {
    hole.remove();
    if (piece) piece.classList.remove('imploding-piece');
    document.querySelectorAll('#board img.pulled-piece').forEach(pc => {
      pc.classList.remove('pulled-piece');
      pc.style.removeProperty('--pullx'); pc.style.removeProperty('--pully');
    });
  }, 1300);
}

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
  wsSend({ type: 'committed' });   // freeze our server clock now -- don't let the eval eat it
  // hand the clock to the opponent until our turn comes back
  S.lastFrom = from; S.lastTo = to;
  if (moveObj.captured) sndCapture(); else sndMove();
  S.selected = null; S.legalMoves = [];
  renderBoard();
  if (moveObj.captured) {
    S.capturedMe.push((S.myColor==='white'?'b':'w') + moveObj.captured.toUpperCase());
    updateCaptures();
  }

  // JUDGING: eval true before AND after positions, fresh, in parallel.
  S.judging = true; webFxStart();
  boardGlow('judging');
  const fenAfter = S.chess.fen();

  const [evalBeforeWhitePOV, evalAfterWhitePOV] = await Promise.all([
    sfEval(fenBefore),
    sfEval(fenAfter),
  ]);

  S.judging = false;

  await runVerdict({ moveObj, from, to, fenBefore, evalBeforeWhitePOV, evalAfterWhitePOV });
}

// Builds blunderDetail, decides safe vs blunder, drives reveal + networking.
// Teachable replay on blunder: undo the move, show the best move, then fade out.
// Draw an arrow over the board from one square to another. Knights get an L-bend.
function drawBestArrow(fromSq, toSq, isKnight) {
  const board = document.getElementById('board');
  if (!board) return null;
  const rect = board.getBoundingClientRect();
  const cell = rect.width / 8;
  const flipped = S.myColor === 'black';
  // square name -> pixel center relative to board
  const center = (sq) => {
    let file = sq.charCodeAt(0) - 97;        // a..h -> 0..7
    let rank = parseInt(sq[1]) - 1;          // 1..8 -> 0..7
    let col = flipped ? 7 - file : file;
    let row = flipped ? rank : 7 - rank;
    return { x: col * cell + cell/2, y: row * cell + cell/2 };
  };
  const a = center(fromSq), b = center(toSq);

  let pathD;
  if (isKnight) {
    // L-shape: go the LONG axis first (2 squares), then bend to the target.
    const dx = b.x - a.x, dy = b.y - a.y;
    let bend;
    if (Math.abs(dx) > Math.abs(dy)) {
      // horizontal long leg, then vertical
      bend = { x: b.x, y: a.y };
    } else {
      // vertical long leg, then horizontal
      bend = { x: a.x, y: b.y };
    }
    pathD = 'M ' + a.x + ' ' + a.y + ' L ' + bend.x + ' ' + bend.y + ' L ' + b.x + ' ' + b.y;
  } else {
    pathD = 'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y;
  }

  let ov = document.getElementById('best-arrow');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'best-arrow';
  ov.style.cssText = 'position:absolute;left:0;top:0;width:' + rect.width + 'px;height:' + rect.height + 'px;pointer-events:none;z-index:50;';
  ov.innerHTML =
    '<svg width="' + rect.width + '" height="' + rect.height + '" style="overflow:visible">' +
    '<defs><marker id="ah" markerWidth="6" markerHeight="6" refX="3.5" refY="3" orient="auto">' +
    '<path d="M0,0 L6,3 L0,6 Z" fill="#34D399"/></marker></defs>' +
    '<path d="' + pathD + '" fill="none" stroke="#34D399" stroke-width="' + (cell*0.10).toFixed(1) +
    '" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#ah)" opacity="0.92"/>' +
    '</svg>';
  // position the overlay over the board (board-wrap is positioned relative)
  board.parentElement.appendChild(ov);
  return ov;
}

async function blunderReplay(fenBefore, badFrom, badTo, detail) {
  // ---- Phase 1: WHY it lost. Board stays on the blundered position so you
  //      can see the hung piece; explanation sits off to the side. (15s) ----
  const hung = document.querySelector('#board [data-sq="' + badTo + '"]');
  if (hung) hung.classList.add('teach-hung');
  let threat = null;
  if (detail && detail.attackerFrom && detail.attackerFrom !== '?') {
    threat = document.querySelector('#board [data-sq="' + detail.attackerFrom + '"]');
    if (threat) threat.classList.add('teach-threat');
  }
  showWhyPanel(detail, badTo);
  await new Promise(r => setTimeout(r, 15000));
  if (hung) hung.classList.remove('teach-hung');
  if (threat) threat.classList.remove('teach-threat');
  hideTeachPanel();

  // ---- Phase 2: rewind to the pre-blunder position, then show the 3 best
  //      moves you could have played instead, each with its own arrow. ----
  try { S.chess.undo(); } catch (e) {}
  S.lastFrom = null; S.lastTo = null;
  renderBoard();

  let top = [];
  try { top = await sfTopMoves(fenBefore, 3); } catch (e) { top = []; }
  if (top && top.length) {
    const colors = ['#34D399', '#3B82F6', '#F59E0B'];
    const items = top.map((mv, i) => {
      const info = describeMove(fenBefore, mv, i);
      drawTeachArrow(mv.from, mv.to, info.knight, colors[i], i + 1);
      return { rank: i + 1, color: colors[i], san: info.san, lead: info.lead, why: info.why };
    });
    showBetterPanel(items);
    await new Promise(r => setTimeout(r, 9000));
  }

  // ---- Hard cleanup so nothing lingers into the result screen ----
  clearTeachArrows();
  hideTeachPanel();
  document.querySelectorAll('#board .teach-hung, #board .teach-threat').forEach(el => {
    el.classList.remove('teach-hung'); el.classList.remove('teach-threat');
  });
}

async function runVerdict({ moveObj, from, to, fenBefore, evalBeforeWhitePOV, evalAfterWhitePOV }) {
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
  S.lastMoveDelta = playerPovDelta;
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
    // Tell the server immediately (so the result is recorded), but hold the
    // visual result until the teachable replay finishes.
    S.replaying = true; S._pendingGameOver = null;
    wsSend({ type: 'blunder', san: moveObj.san, worstLoss, detail: blunderDetail });

    // Drama beat first
    boardGlow(evalDrop >= 3.0 ? 'superbad' : 'bad', 1400);
    blunderEffect(to);
    webFxVerdict('death', to, playerPovDelta);
    sndBlunder();

    // Then: undo + show the best move, before the result screen appears.
    await blunderReplay(fenBefore, from, to, blunderDetail);
    S.replaying = false;
    // If the server's game_over arrived during the replay, show it now.
    if (S._pendingGameOver) { const m = S._pendingGameOver; S._pendingGameOver = null; onGameOver(m); return; }
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

    // Replay has finished (awaited above). Now show the result — no race.
    if (!S._gameOverFired && !document.getElementById('result-modal').classList.contains('show')) {
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
    return;
  }

  // ════════════ SAFE ════════════
  boardGlow(playerPovDelta >= 1.5 ? 'supergood' : 'good', 1100);
  webFxVerdict('safe', to, playerPovDelta);
  // Quick green pulse on the square you survived
  const safeSq = document.querySelector('#board [data-sq="' + to + '"]');
  if (safeSq) {
    safeSq.classList.add('verdict-safe');
    setTimeout(() => safeSq.classList.remove('verdict-safe'), 600);
  }
  // Genuinely good move (eval gained ≥0.8) gets a reward flash
  if (quality === 'good') {
    goodEffect(to, playerPovDelta, !!moveObj.captured);
  } else if (safeSq) {
    sparkle(safeSq, 10, 'green');
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
  startLocalTimer();   // opponent's turn -- restart and count down
}

// Opponent's move comes from server
async function onOpponentMove(msg) {
  if (!S.chess || msg.color === S.myColor) return;
  if (msg.isBlunder) return; // server will send game_over
  stopLocalTimer();   // opponent moved -- stop their clock immediately

  // Capture the position BEFORE their move so we can judge it like ours.
  const fenBeforeOpp = S.chess.fen();

  const moveObj = S.chess.move({ from: msg.from, to: msg.to, promotion: 'q' });
  if (!moveObj) return;

  S.lastFrom = msg.from; S.lastTo = msg.to;
  if (moveObj.captured) sndCapture(); else sndMove();
  if (moveObj.captured) {
    S.capturedOpp.push((S.myColor==='white'?'w':'b') + moveObj.captured.toUpperCase());
    updateCaptures();
  }
  S.moveHistory.push({ san: moveObj.san, color: msg.color, quality: '' });
  updateMoveLog();
  renderBoard();

  // JUDGING: lock the board, eval their before+after, same as my moves.
  S.judging = true; webFxStart();
  boardGlow('judging');
  const fenAfterOpp = S.chess.fen();

  let evalBeforeW = 0, evalAfterW = 0;
  try {
    [evalBeforeW, evalAfterW] = await Promise.all([
      sfEval(fenBeforeOpp),
      sfEval(fenAfterOpp),
    ]);
  } catch(e) {}

  S.judging = false;
  S.evalScore = evalAfterW;
  updateEvalUI();

  // Opponent's drop (from THEIR POV). Opp is the color that isn't mine.
  const oppColor = S.myColor === 'white' ? 'black' : 'white';
  const rawDropOpp = oppColor === 'white'
    ? evalBeforeW - evalAfterW
    : evalAfterW - evalBeforeW;
  const TEMPO_OFFSET = 0.7;
  const oppDrop = rawDropOpp - TEMPO_OFFSET;

  console.log('[SF opp]', 'before(W):', evalBeforeW.toFixed(2),
    'after(W):', evalAfterW.toFixed(2), 'oppDrop:', oppDrop.toFixed(2));

  // Glow from MY POV: my standing after their move.
  const myStanding = S.myColor === 'white' ? evalAfterW : -evalAfterW;

  // Did the OPPONENT blunder? Same threshold as me. If so, I win instantly.
  const BLUNDER_THRESHOLD = 1.5;
  if (oppDrop >= BLUNDER_THRESHOLD && !S.gameOver) {
    boardGlow(oppDrop >= 3.0 ? 'supergood' : 'good', 1600);
    sndWin();
    wsSend({ type: 'opp_blunder', san: moveObj.san });
    // Failsafe local win if server is slow / it's a bot game.
    setTimeout(() => {
      if (!S._gameOverFired && !document.getElementById('result-modal').classList.contains('show')) {
        onGameOver({
          type: 'game_over',
          reason: 'Opponent blundered — ' + moveObj.san,
          winner: S.myColor,
          winnerUsername: S.user ? S.user.username : 'You',
          ratings: {
            white: { old: S.user.rating, new: S.user.rating + 12, delta: 12 },
            black: { old: S.user.rating, new: S.user.rating + 12, delta: 12 }
          },
          noAdsUnlocked: { white: false, black: false }
        });
      }
    }, 1200);
    return;
  }

  // Normal: glow from my POV, hand the clock back to me.
  boardGlow(myStanding > 1.5 ? 'good' : myStanding < -1.5 ? 'bad' : 'idle', 1100);
  updateTurnUI();
  wsSend({ type: 'ready' });   // done judging the opponent's move -> server starts my clock now (full 5s)
  startLocalTimer();

  // Cache my pre-move baseline for my upcoming move.
  S.preMoveEval = evalAfterW;
}

// Server timer sync
function onServerTimer(msg) {
  // The local interval drives the smooth countdown; the server is authoritative
  // for the real timeout, so only correct the display on meaningful drift.
  if (typeof msg.value === 'number' && Math.abs(msg.value - S.timerVal) >= 2) {
    S.timerVal = msg.value;
    updateTimerUI();
  }
}

// ══════════════════════════════════════════
// LOCAL TIMER (mirrors server timer)
// ══════════════════════════════════════════
function startLocalTimer() {
  S.timerVal = 5;
  S.moveStartTime = Date.now();
  updateTimerUI();
  clearInterval(S.localTimerInterval);
  S.localTimerInterval = setInterval(() => {
    if (S.timerVal > 0) {
      S.timerVal--;
      updateTimerUI();
      if (S.timerVal <= 3 && S.timerVal > 0) sndTick();
    } else {
      clearInterval(S.localTimerInterval);
      S.localTimerInterval = null;
    }
  }, 750);
}

function stopLocalTimer() {
  clearInterval(S.localTimerInterval);
  S.localTimerInterval = null;
  const game = document.getElementById('s-game');
  if (game) game.classList.remove('time-ok','time-warn','time-crit');
  const hud = document.getElementById('timehud');
  if (hud) { hud.classList.remove('warn','crit'); hud.classList.add('ok'); }
}

function updateTimerUI() {
  const v = S.timerVal;
  const max = 5;
  const frac = Math.max(0, Math.min(1, v / max));
  const reset = v >= max;
  const state = v > 3 ? 'ok' : v > 2 ? 'warn' : 'crit';

  const num = document.getElementById('th-num');
  const bar = document.getElementById('th-fill');
  const hud = document.getElementById('timehud');
  if (num) num.textContent = v;
  if (bar) { bar.style.transition = reset ? 'none' : ''; bar.style.width = (frac * 100) + '%'; }
  if (hud) { hud.classList.remove('ok','warn','crit'); hud.classList.add(state); }

  const game = document.getElementById('s-game');
  if (game) { game.classList.remove('time-ok','time-warn','time-crit'); game.classList.add('time-' + state); }
}

// ══════════════════════════════════════════
// EVAL UI
// ══════════════════════════════════════════
function updateEvalUI() {
  const score = S.myColor === 'white' ? S.evalScore : -S.evalScore;
  const pct = Math.min(92, Math.max(8, 50+(score/6)*42));
  document.getElementById('eval-fill').style.height = pct+'%';
  document.getElementById('eval-num').textContent = (score>0?'+':'')+score.toFixed(1);
  // Danger meter: how much ground I lost since the previous eval (my POV).
  const prevScore = (typeof S._meterPrevScore === 'number') ? S._meterPrevScore : score;
  const lossDelta = Math.max(0, prevScore - score);
  S._meterPrevScore = score;
  document.getElementById('bm-fill').style.width = Math.min(100,(lossDelta/2.0)*100)+'%';
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
  // If the blunder replay is still playing, hold the result until it finishes.
  if (S.replaying) { console.log('[GAME OVER] deferred until replay ends'); S._pendingGameOver = msg; return; }
  S._gameOverFired = true;
  console.log('[GAME OVER]', JSON.stringify(msg));
  S.gameOver = true;
  stopLocalTimer();
  // Helper that won't crash on missing elements
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setCls = (id, cls) => { const el = document.getElementById(id); if (el) el.className = cls; };

  const iWon = msg.winner === S.myColor;
  if (iWon) { sndWin(); S.streak++; flashB('fg'); flashOv('rgba(45,198,83,.2)'); victoryFx(); }
  else { sndBlunder(); S.streak = 0; flashB('fr'); flashOv('rgba(230,57,70,.25)'); defeatFx(); }

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
  }

  const myMoves = S.moveHistory.filter(m => m.color === S.myColor);
  const acc = myMoves.length ? Math.round(myMoves.filter(m=>m.quality!=='blunder'&&m.quality!=='inaccuracy').length/myMoves.length*100) : 100;
  const avgT = S.moveTimings.length ? Math.round(S.moveTimings.reduce((a,b)=>a+b,0)/S.moveTimings.length) : '—';

  setEl('m-icon', iWon ? '👑' : '💀'); setEl('m-knight', iWon ? '👑' : '💀');
  setEl('m-title', iWon ? 'VICTORY' : 'DEFEATED');
  setCls('m-title', 'modal-title ' + (iWon?'win':'loss'));
  setEl('m-reason', msg.reason);

  // "Why you lost" blunder-explanation panel removed.
  const explainEl = document.getElementById('m-blunder-explain');
  if (explainEl) explainEl.remove();
  setEl('m-r-old', myRatings.old);
  setEl('m-r-new', myRatings.new);
  setEl('m-r-delta', (myRatings.delta >= 0 ? '+' : '') + myRatings.delta);
  setCls('m-r-delta', 'r-delta ' + (myRatings.delta >= 0 ? 'up' : 'dn'));
  setEl('m-moves', myMoves.length);
  setEl('m-acc', acc + '%');
  setEl('m-time', typeof avgT === 'number' ? avgT+'s' : avgT);

  const noAdsEl = document.getElementById('no-ads-unlock');
  noAdsEl.style.display = (msg.noAdsUnlocked && msg.noAdsUnlocked[S.myColor]) ? 'block' : 'none';
  injectBestMoveCTA(iWon);
  injectGuestSaveCTA();

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

// ══════════════════════════════════════════
// PREMIUM UPSELL  (best-move reveal is now a paid feature)
// ══════════════════════════════════════════
function injectBestMoveCTA(iWon) {
  const old = document.getElementById('btn-see-best');
  if (old) old.remove();
  if (iWon) return;
  if (S.user && S.user.is_premium) return;   // premium already gets the auto best-move reveal
  const modal = document.querySelector('#result-modal .modal');
  const btns = document.querySelector('#result-modal .modal-btns');
  if (!modal || !btns) return;
  const b = document.createElement('button');
  b.id = 'btn-see-best';
  b.textContent = '🔓 See Best Move';
  b.style.cssText = 'width:100%;background:linear-gradient(135deg,#FF7A1A,#F5C518);color:#0E1116;border:none;padding:15px;margin-bottom:10px;font-family:Antonio,sans-serif;font-size:20px;font-weight:700;letter-spacing:2px;cursor:pointer;border-radius:4px;box-shadow:0 0 24px rgba(255,122,26,.35)';
  b.onmouseenter = () => { b.style.filter = 'brightness(1.08)'; };
  b.onmouseleave = () => { b.style.filter = 'none'; };
  b.onclick = showPremium;
  modal.insertBefore(b, btns);
}

function injectGuestSaveCTA() {
  const old = document.getElementById('btn-guest-save');
  if (old) old.remove();
  if (!S.user || !S.user.guest) return;     // only guests see this
  const modal = document.querySelector('#result-modal .modal');
  const btns = document.querySelector('#result-modal .modal-btns');
  if (!modal || !btns) return;
  const b = document.createElement('button');
  b.id = 'btn-guest-save';
  b.textContent = '\uD83D\uDCBE Save your rating & streak \u2014 free account';
  b.style.cssText = 'width:100%;background:linear-gradient(135deg,#34D399,#0EA5E9);color:#0E1116;border:none;padding:15px;margin-bottom:10px;font-family:Antonio,sans-serif;font-size:19px;font-weight:700;letter-spacing:1px;cursor:pointer;border-radius:4px;box-shadow:0 0 22px rgba(52,211,153,.3)';
  b.onmouseenter = () => { b.style.filter = 'brightness(1.07)'; };
  b.onmouseleave = () => { b.style.filter = 'none'; };
  b.onclick = () => {
    document.getElementById('result-modal').classList.remove('show');
    if (!signupMode) document.getElementById('btn-toggle').click();   // flip into Create Account mode
    show('s-login');
    const u = document.getElementById('inp-user'); if (u) u.focus();
    toast('Create a free account to keep your progress');
  };
  modal.insertBefore(b, btns);
}

function showPremium() {
  let ov = document.getElementById('premium-overlay');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'premium-overlay';
  const benefits = [
    ['🎯','Instant best-move reveal',"See exactly what you should have played — after every blunder."],
    ['🧠','Personal coaching',"Spot the mistakes you keep making, and the moves that beat them."],
    ['🚫','Zero ads. Forever.',"No banners, no interruptions. Just pure chess."],
    ['♟️','Train at any level',"Play bots from total beginner to master strength, 600–2400."],
    ['🎨','Premium texture packs',"Unlock exclusive boards, piece sets, and themes."],
    ['📊','Deep game analysis',"Full history, rating trends, and accuracy breakdowns."],
    ['⚡','Top 3 moves you missed',"See the strongest moves you didn't find, every game."],
    ['👑','Premium badge',"Show off a premium badge right next to your name."],
  ];
  const rows = benefits.map(function(item){
    const icon = item[0], title = item[1], sub = item[2];
    return '<div style="display:flex;gap:16px;align-items:flex-start;padding:15px 0;border-bottom:1px solid rgba(255,255,255,0.06)">' +
      '<div style="font-size:30px;line-height:1;flex-shrink:0">' + icon + '</div>' +
      '<div><div style="font-family:Antonio,sans-serif;font-size:24px;font-weight:700;color:#F5F1EA;letter-spacing:.5px;line-height:1.1">' + title + '</div>' +
      '<div style="font-size:14px;color:#A1A1AA;margin-top:3px;line-height:1.35">' + sub + '</div></div></div>';
  }).join('');

  ov.style.cssText = 'position:fixed;inset:0;z-index:2000;overflow-y:auto;background:radial-gradient(ellipse 90% 55% at 50% 0%, rgba(255,122,26,0.16) 0%, transparent 60%), #0E1116';
  ov.innerHTML =
    '<div style="position:relative;width:100%;max-width:480px;margin:0 auto;padding:26px 22px 44px">' +
      '<button id="prem-close" style="position:absolute;top:16px;right:16px;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.08);border:none;color:#F5F1EA;font-size:20px;cursor:pointer;line-height:1">×</button>' +
      '<div style="text-align:center;margin-top:6px;margin-bottom:10px;font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:5px;color:#FF7A1A;text-transform:uppercase">Sudden Death Premium</div>' +
      '<h1 style="text-align:center;font-family:Antonio,sans-serif;font-size:40px;font-weight:700;line-height:1.04;color:#F5F1EA;margin-bottom:10px">STOP LOSING<br>THE SAME WAY TWICE</h1>' +
      '<p style="text-align:center;font-size:15px;color:#A1A1AA;margin-bottom:22px;line-height:1.4">Every blunder is a lesson. Premium shows you the lesson — and turns you into a player who does not repeat it.</p>' +
      '<div style="margin-bottom:22px">' + rows + '</div>' +
      '<div style="text-align:center;margin-bottom:16px">' +
        '<div style="display:inline-flex;align-items:baseline;gap:6px">' +
          '<span style="font-family:Antonio,sans-serif;font-size:30px;font-weight:700;color:#F5F1EA">$4.99</span>' +
          '<span style="font-size:13px;color:#A1A1AA">/ month</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#52525B;margin-top:2px">that is just $0.16 a day — less than a single coffee</div>' +
        '<div style="font-size:12px;color:#34D399;margin-top:6px">or $39.99 / year — save 33%</div>' +
      '</div>' +
      '<button id="prem-cta" style="width:100%;background:linear-gradient(135deg,#FF7A1A,#F5C518);color:#0E1116;border:none;padding:16px;font-family:Antonio,sans-serif;font-size:21px;font-weight:700;letter-spacing:2px;cursor:pointer;border-radius:6px;box-shadow:0 0 36px rgba(255,122,26,.4)">SUBSCRIBE \u2014 $4.99/mo</button>' +
      '<button id="prem-cta-year" style="width:100%;margin-top:10px;background:transparent;color:#34D399;border:1px solid #34D399;padding:14px;font-family:Antonio,sans-serif;font-size:18px;font-weight:700;letter-spacing:2px;cursor:pointer;border-radius:6px">Best value \u2014 $39.99/yr</button>' +
      '<div style="text-align:center;font-size:11px;color:#52525B;margin-top:12px">Cancel anytime · No commitment</div>' +
      '<div id="prem-later" style="text-align:center;font-size:13px;color:#A1A1AA;margin-top:18px;cursor:pointer;text-decoration:underline">Maybe later</div>' +
    '</div>';
  document.body.appendChild(ov);
  document.getElementById('prem-close').onclick = closePremium;
  document.getElementById('prem-later').onclick = closePremium;
  document.getElementById('prem-cta').onclick = () => startCheckout('monthly');
  { const yb = document.getElementById('prem-cta-year'); if (yb) yb.onclick = () => startCheckout('annual'); }
}

function startCheckout(plan) {
  if (!S.token || (S.user && S.user.guest)) {
    closePremium();
    if (typeof signupMode !== 'undefined' && !signupMode) { const t = document.getElementById('btn-toggle'); if (t) t.click(); }
    show('s-login');
    toast('Create a free account first, then subscribe');
    return;
  }
  toast('Opening secure checkout\u2026');
  fetch('/api/payments/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.token },
    body: JSON.stringify({ plan: plan === 'annual' ? 'annual' : 'monthly' })
  }).then(r => r.json()).then(data => {
    if (data && data.url) window.location.href = data.url;
    else toast(data && data.error ? data.error : 'Checkout is not available yet.');
  }).catch(() => toast('Could not start checkout. Try again.'));
}

function closePremium() {
  const ov = document.getElementById('premium-overlay');
  if (ov) ov.remove();
}

function showPremiumWelcome() {
  let ov = document.getElementById('premium-welcome');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'premium-welcome';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2200;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(ellipse 90% 60% at 50% 0%, rgba(245,197,24,0.18) 0%, transparent 60%), rgba(14,17,22,0.97)';
  const perks = [
    ['\uD83C\uDFAF','Best-move reveal','After every blunder, see the move that would have saved you.'],
    ['\uD83D\uDEAB','Zero ads, forever','No banners, no interruptions \u2014 just chess.'],
    ['\uD83C\uDFA8','Texture packs','Unlock premium boards and themes.'],
    ['\uD83D\uDC51','Premium badge','A crown on your profile, for everyone to see.']
  ];
  const rows = perks.map(p => '<div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06)">' +
    '<div style="font-size:26px;flex-shrink:0">' + p[0] + '</div>' +
    '<div><div style="font-family:Antonio,sans-serif;font-size:20px;font-weight:700;color:#F5F1EA">' + p[1] + '</div>' +
    '<div style="font-size:13px;color:#A1A1AA;margin-top:2px">' + p[2] + '</div></div></div>').join('');
  ov.innerHTML = '<div style="width:100%;max-width:440px;text-align:center">' +
    '<div style="font-size:64px;filter:drop-shadow(0 0 18px rgba(245,197,24,0.8))">\uD83D\uDC51</div>' +
    '<div style="font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:6px;color:#F5C518;text-transform:uppercase;margin-top:10px">Welcome to Premium</div>' +
    '<h1 style="font-family:Antonio,sans-serif;font-size:42px;font-weight:700;color:#F5F1EA;line-height:1.05;margin:8px 0 6px">YOU\u2019RE IN.</h1>' +
    '<p style="font-size:15px;color:#A1A1AA;margin-bottom:22px;line-height:1.4">Thanks for going Premium. Everything below is unlocked on your account right now.</p>' +
    '<div style="text-align:left;margin-bottom:26px">' + rows + '</div>' +
    '<button id="pw-start" style="width:100%;background:linear-gradient(135deg,#FF7A1A,#F5C518);color:#0E1116;border:none;padding:17px;font-family:Antonio,sans-serif;font-size:22px;font-weight:700;letter-spacing:2px;cursor:pointer;border-radius:6px;box-shadow:0 0 30px rgba(245,197,24,.4)">START PLAYING</button>' +
    '</div>';
  document.body.appendChild(ov);
  document.getElementById('pw-start').onclick = () => ov.remove();
}

// ══════════════════════════════════════════
// CONTENT RECORDER  (9:16 reel: face cam + board + branding)
// ══════════════════════════════════════════
const REC = { active:false, recorder:null, chunks:[], raf:null, canvas:null, ctx:null, video:null, stream:null, userStream:null, pieceImgs:null, mime:'', ext:'webm' };

function recPickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const cands = ['video/mp4;codecs=avc1','video/mp4;codecs=h264','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  for (const m of cands) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch(e){} }
  return '';
}

function recLoadPieces() {
  // Use the SAME high-contrast pieces as the live board. Load them cross-origin
  // so the canvas stays clean for recording; if a CORS load fails, fall back to
  // the inline SVG set (which can never taint).
  const keys = Object.keys(PIECE_SVG);
  const map = {};
  function fallback(k, res) {
    const img = new Image();
    img.onload = () => { map[k] = img; res(); };
    img.onerror = () => res();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(PIECE_SVG[k]);
  }
  function loadOne(k) {
    return new Promise(res => {
      const url = (typeof PIECE_IMGS_URLS !== 'undefined') ? PIECE_IMGS_URLS[k] : null;
      if (!url) return fallback(k, res);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { map[k] = img; res(); };
      img.onerror = () => fallback(k, res); // no CORS -> load fails -> safe inline fallback
      img.src = url;
    });
  }
  return Promise.all(keys.map(loadOne)).then(() => map);
}

function recDrawFrame() {
  const ctx = REC.ctx, W = 540, H = 960, now = Date.now();
  const pulse = 0.5 + 0.5 * Math.sin(now / 150);

  if (REC._prevJudging && !S.judging && !S.gameOver) REC._safeUntil = now + 1100;
  if (S.gameOver) REC._safeUntil = 0;
  REC._prevJudging = S.judging;
  const phase = S.gameOver ? 'death' : (S.judging ? 'judging' : (now < (REC._safeUntil || 0) ? 'safe' : 'idle'));

  const bSize = 480, bX = 30, bY = 356, cell = bSize/8;
  const bcx = bX + bSize/2, bcy = bY + bSize/2;
  const flipped = S.myColor === 'black';
  function originOf(sq) {
    if (!sq || sq.length < 2) return [bcx, bcy];
    const f = sq.charCodeAt(0)-97, ri = parseInt(sq[1])-1;
    if (isNaN(f) || isNaN(ri)) return [bcx, bcy];
    const col = flipped?7-f:f, row = flipped?ri:7-ri;
    return [bX+col*cell+cell/2, bY+row*cell+cell/2];
  }

  if (phase !== REC._prevPhase) {
    const o = originOf(S.lastTo);
    const tier = fxTier(typeof S.lastMoveDelta === 'number' ? S.lastMoveDelta : 0, phase === 'death');
    if (phase === 'safe') { REC._streak = (REC._streak||0) + 1; REC._streakPop = now; }
    if (phase === 'death') { REC._streak = 0; }
    if (phase === 'safe' || phase === 'death') {
      REC._fx = { type:phase, start:now, x:o[0], y:o[1], rgb:tier.flash, label:tier.label };
      recBurst(o[0], o[1], tier.part, tier.n);
    }
  }
  REC._prevPhase = phase;
  const fx = REC._fx;
  const fxT = fx ? (now - fx.start) / 700 : 2;
  const fxX = fx ? fx.x : bcx, fxY = fx ? fx.y : bcy;

  ctx.setTransform(1,0,0,1,0,0);
  ctx.fillStyle = '#0E1116'; ctx.fillRect(0,0,W,H);
  let shx = 0, shy = 0;
  if (fx && fx.type === 'death' && fxT < 0.45) {
    const amp = 14 * (1 - fxT/0.45);
    shx = (Math.random()-0.5) * amp; shy = (Math.random()-0.5) * amp;
  }
  let punch = 1;
  if (fx && fxT < 0.3) punch = 1 + 0.05 * (1 - fxT/0.3);
  ctx.save();
  ctx.translate(W/2, H/2); ctx.scale(punch, punch); ctx.translate(-W/2, -H/2);
  ctx.translate(shx, shy);
  ctx.textBaseline = 'middle';

  const camH = 280;
  if (REC.video && REC.video.videoWidth) {
    const v = REC.video, vw = v.videoWidth, vh = v.videoHeight;
    const scale = Math.max(W/vw, camH/vh), dw = vw*scale, dh = vh*scale;
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,W,camH); ctx.clip();
    ctx.drawImage(v, (W-dw)/2, (camH-dh)/2, dw, dh); ctx.restore();
  } else { ctx.fillStyle = '#191D24'; ctx.fillRect(0,0,W,camH); }

  if ((REC._streak||0) > 0) {
    const sp = REC._streakPop ? Math.max(0, 1 - (now - REC._streakPop)/350) : 0;
    const bs = 1 + 0.3*sp;
    ctx.save(); ctx.translate(18, 34); ctx.scale(bs, bs);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = '700 30px Antonio, sans-serif';
    ctx.fillStyle = '#FF7A1A';
    ctx.fillText('\uD83D\uDD25 ' + REC._streak, 0, 0);
    ctx.font = '700 11px JetBrains Mono, monospace'; ctx.fillStyle = '#F5F1EA';
    ctx.fillText('SURVIVED', 2, 24);
    ctx.restore(); ctx.textBaseline = 'middle';
  }

  ctx.fillStyle = '#14171C'; ctx.fillRect(0, camH, W, 66);
  ctx.textAlign = 'left'; ctx.font = '700 21px Antonio, sans-serif';
  ctx.fillStyle = '#FF7A1A'; ctx.fillText('SUDDEN', 16, camH+26);
  let sw = ctx.measureText('SUDDEN').width;
  ctx.fillStyle = '#E11D2E'; ctx.fillText('DEATH', 16+sw+6, camH+26);
  sw += ctx.measureText('DEATH').width + 12;
  ctx.fillStyle = '#F5F1EA'; ctx.fillText('CHESS', 16+sw, camH+26);
  ctx.fillStyle = '#6B7280'; ctx.font = '700 11px JetBrains Mono, monospace';
  ctx.fillText('ONE WRONG MOVE = DEATH', 16, camH+48);

  const tv = Math.max(0, (typeof S.timerVal === 'number') ? S.timerVal : 5);
  const tcol = tv > 3 ? '#34D399' : (tv > 1 ? '#F5C518' : '#E11D2E');
  ctx.textAlign = 'right';
  ctx.fillStyle = '#52525B'; ctx.font = '700 10px JetBrains Mono, monospace';
  ctx.fillText('TIME LEFT', W-18, camH+17);
  const tscale = (tv <= 2 && phase !== 'death') ? (1 + 0.12*pulse) : 1;
  ctx.save(); ctx.translate(W-22, camH+44); ctx.scale(tscale, tscale);
  ctx.fillStyle = tcol; ctx.font = '700 40px Antonio, sans-serif';
  ctx.fillText(String(tv), 0, 0); ctx.restore();
  ctx.textAlign = 'left';

  for (let r=0;r<8;r++) for (let f=0;f<8;f++) {
    const col = flipped?7-f:f, row = flipped?r:7-r;
    ctx.fillStyle = ((f+r)%2===0) ? '#3A2E26' : '#E8D7B5';
    ctx.fillRect(bX+col*cell, bY+row*cell, cell, cell);
  }
  if (REC.pieceImgs && S.chess) {
    [S.lastFrom, S.lastTo].filter(Boolean).forEach(sq => {
      const f = sq.charCodeAt(0)-97, ri = parseInt(sq[1])-1;
      const col = flipped?7-f:f, row = flipped?ri:7-ri;
      ctx.fillStyle = 'rgba(255,122,26,0.32)';
      ctx.fillRect(bX+col*cell, bY+row*cell, cell, cell);
    });
    for (let rr=1;rr<=8;rr++) for (let f=0;f<8;f++) {
      const sq = 'abcdefgh'[f]+rr;
      let p; try { p = S.chess.get(sq); } catch(e){ p=null; }
      if (!p) continue;
      const img = REC.pieceImgs[(p.color==='w'?'w':'b')+p.type.toUpperCase()];
      if (!img || !img.complete || !img.naturalWidth) continue;
      const col = flipped?7-f:f, row = flipped?(rr-1):(8-rr);
      try { ctx.drawImage(img, bX+col*cell+3, bY+row*cell+3, cell-6, cell-6); } catch(e){}
    }
  }

  if (phase === 'judging') {
    const g = ctx.createRadialGradient(bcx, bcy, bSize*0.22, bcx, bcy, bSize*0.85);
    g.addColorStop(0, 'rgba(225,29,46,0)');
    g.addColorStop(1, 'rgba(225,29,46,' + (0.18 + 0.24*pulse).toFixed(2) + ')');
    ctx.fillStyle = g; ctx.fillRect(0, camH, W, bY+bSize - camH + 70);
  }

  if (fx && fxT < 1) {
    const col = (fx && fx.rgb) ? fx.rgb : (fx.type === 'safe' ? '52,211,153' : '225,29,46');
    ctx.strokeStyle = 'rgba(' + col + ',' + (1-fxT).toFixed(2) + ')';
    ctx.lineWidth = 10*(1-fxT)+2;
    ctx.beginPath(); ctx.arc(fxX, fxY, cell*0.4 + fxT*bSize*0.5, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = 'rgba(' + col + ',' + (0.4*(1-fxT)).toFixed(2) + ')';
    ctx.fillRect(0,0,W,H);
  }

  recDrawParticles(ctx);

  let bcr = '#3D4A5C', bw = 2;
  if (phase === 'judging') { bcr = 'rgba(255,122,26,' + (0.4+0.6*pulse).toFixed(2) + ')'; bw = 6; }
  else if (phase === 'death') { bcr = '#E11D2E'; bw = 9; }
  else if (phase === 'safe') { bcr = '#34D399'; bw = 7; }
  ctx.strokeStyle = bcr; ctx.lineWidth = bw;
  ctx.strokeRect(bX-bw/2, bY-bw/2, bSize+bw, bSize+bw);

  const sy = bY + bSize + 30;
  ctx.textAlign = 'center';
  if (phase === 'judging') {
    const dots = '.'.repeat(1 + (Math.floor(now/300)%3));
    const hb = 1 + 0.07*pulse;
    ctx.save(); ctx.translate(W/2, sy); ctx.scale(hb, hb);
    ctx.fillStyle = 'rgba(255,122,26,' + (0.6+0.4*pulse).toFixed(2) + ')';
    ctx.font = '700 30px Antonio, sans-serif';
    ctx.fillText('DID IT SURVIVE' + dots, 0, 0); ctx.restore();
  } else if (phase === 'death') {
    const pop = fx ? Math.min(1, fxT*3) : 1;
    ctx.save(); ctx.translate(W/2, sy); ctx.scale(0.7+0.35*pop, 0.7+0.35*pop);
    ctx.fillStyle = '#E11D2E'; ctx.font = '700 42px Antonio, sans-serif';
    ctx.fillText((fx && fx.label) || '\u2620 GAME OVER', 0, 0); ctx.restore();
  } else if (phase === 'safe') {
    ctx.fillStyle = (fx && fx.rgb) ? ('rgb('+fx.rgb+')') : '#34D399'; ctx.font = '700 36px Antonio, sans-serif';
    ctx.fillText((fx && fx.label) || '\u2713 SURVIVED', W/2, sy);
  } else {
    ctx.fillStyle = '#A1A1AA'; ctx.font = '700 21px Antonio, sans-serif';
    ctx.fillText('MAKE YOUR MOVE', W/2, sy);
  }

  ctx.fillStyle = 'rgba(255,122,26,0.16)'; ctx.fillRect(0, H-52, W, 52);
  ctx.fillStyle = '#FF7A1A'; ctx.font = '700 20px JetBrains Mono, monospace';
  ctx.fillText('\u25B6 suddendeathchess.up.railway.app', W/2, H-26);

  const eg = ctx.createRadialGradient(W/2, H/2, H*0.30, W/2, H/2, H*0.62);
  eg.addColorStop(0, 'rgba(255,122,26,0)');
  eg.addColorStop(1, 'rgba(255,122,26,' + (0.05 + 0.06*pulse).toFixed(3) + ')');
  ctx.fillStyle = eg; ctx.fillRect(0,0,W,H);

  ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  if (REC.active) REC.raf = requestAnimationFrame(recDrawFrame);
}

function recBurst(cx, cy, color, n) {
  REC._particles = REC._particles || [];
  for (let i=0;i<n;i++) {
    const a = Math.random()*Math.PI*2, sp = 3 + Math.random()*10;
    REC._particles.push({ x:cx, y:cy, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp - 2.5, life:1, color });
  }
}

function recDrawParticles(ctx) {
  const ps = REC._particles; if (!ps || !ps.length) return;
  for (let i = ps.length-1; i >= 0; i--) {
    const p = ps[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.45; p.vx *= 0.98; p.life -= 0.025;
    if (p.life <= 0) { ps.splice(i,1); continue; }
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x-3, p.y-3, 6, 6);
  }
  ctx.globalAlpha = 1;
}

async function startRecording(btn) {
  if (REC.active) return;
  REC.mime = recPickMime();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    toast('Recording is not supported on this browser.'); return;
  }
  try {
    REC.userStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'user', width:640, height:480 }, audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:false } });
  } catch(e) { toast('Camera/mic permission denied.'); return; }

  REC.video = document.createElement('video');
  REC.video.muted = true; REC.video.playsInline = true; REC.video.autoplay = true;
  REC.video.srcObject = REC.userStream;
  try { await REC.video.play(); } catch(e) {}

  REC.pieceImgs = await recLoadPieces();
  REC.canvas = document.createElement('canvas');
  REC.canvas.width = 540; REC.canvas.height = 960;
  REC.ctx = REC.canvas.getContext('2d');
  REC._streak = 0; REC._prevPhase = null; REC._fx = null;
  REC.canvas.id = 'rec-preview';
  REC.canvas.style.cssText = 'position:fixed;top:70px;left:14px;width:108px;height:192px;z-index:1450;border:2px solid #FF7A1A;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.55);background:#000';
  document.body.appendChild(REC.canvas);
  REC.active = true;
  recDrawFrame();

  try { REC.stream = REC.canvas.captureStream(30); }
  catch(e) { toast('Recording blocked by the browser.'); stopRecordingCleanup(); return; }
  try {
    const ac = ga();                       // share the game's audio context so we capture SFX
    if (ac.state === 'suspended') ac.resume();
    const recDest = ac.createMediaStreamDestination();
    try { sfxBus().connect(recDest); } catch (e) {}   // game sound effects into the clip
    const aSrc = ac.createMediaStreamSource(REC.userStream);
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -28; comp.knee.value = 20; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    const makeup = ac.createGain(); makeup.gain.value = 1.5;   // gentler than before
    const gate = ac.createGain(); gate.gain.value = 0;          // noise gate: starts closed
    const analyser = ac.createAnalyser(); analyser.fftSize = 512;
    aSrc.connect(comp); comp.connect(analyser); comp.connect(makeup); makeup.connect(gate); gate.connect(recDest);
    REC._audioNodes = { aSrc, comp, makeup, gate, analyser, recDest, ac };
    REC._gateOpen = false;
    recGateTick();
    recDest.stream.getAudioTracks().forEach(t => REC.stream.addTrack(t));
  } catch (e) {
    REC.userStream.getAudioTracks().forEach(t => REC.stream.addTrack(t));
  }

  REC.chunks = [];
  try {
    REC.recorder = REC.mime
      ? new MediaRecorder(REC.stream, { mimeType: REC.mime, videoBitsPerSecond: 4000000 })
      : new MediaRecorder(REC.stream);
  } catch(e) {
    try { REC.recorder = new MediaRecorder(REC.stream); }
    catch(e2) { toast('Recording failed to start.'); stopRecordingCleanup(); return; }
  }
  const actualMime = (REC.recorder && REC.recorder.mimeType) || REC.mime || '';
  if (actualMime) REC.mime = actualMime;
  REC.ext = (REC.mime.indexOf('webm') >= 0) ? 'webm' : 'mp4';
  REC.recorder.ondataavailable = (e) => { if (e.data && e.data.size) REC.chunks.push(e.data); };
  REC.recorder.onstop = () => finishRecording();
  REC.recorder.start();

  btn.textContent = '⏹ STOP & SAVE';
  btn.style.background = '#E11D2E'; btn.style.color = '#fff'; btn.style.borderColor = '#E11D2E';
  toast('Recording… go make some content!');
}

function stopRecording(btn) {
  if (!REC.active) return;
  REC.active = false;
  if (REC.raf) cancelAnimationFrame(REC.raf);
  { const pv = document.getElementById('rec-preview'); if (pv) pv.remove(); }
  try { if (REC.recorder && REC.recorder.state !== 'inactive') REC.recorder.stop(); } catch(e) {}
  btn.textContent = '🔴 Create Content';
  btn.style.background = 'rgba(225,29,46,0.15)'; btn.style.color = '#E11D2E'; btn.style.borderColor = 'rgba(225,29,46,0.5)';
}

function stopRecordingCleanup() {
  REC.active = false;
  if (REC.raf) cancelAnimationFrame(REC.raf);
  { const pv = document.getElementById('rec-preview'); if (pv) pv.remove(); }
  if (REC.userStream) REC.userStream.getTracks().forEach(t => t.stop());
  recTeardownAudio();
}

function finishRecording() {
  const blob = new Blob(REC.chunks, { type: REC.mime || 'video/webm' });
  if (REC.userStream) REC.userStream.getTracks().forEach(t => t.stop());
  recTeardownAudio();
  const url = URL.createObjectURL(blob);
  const fname = 'sudden-death-' + Date.now() + '.' + REC.ext;
  const file = window.File ? new File([blob], fname, { type: blob.type }) : null;
  showRecordResult(url, file, fname);
}

function showRecordResult(url, file, fname) {
  let ov = document.getElementById('rec-result'); if (ov) ov.remove();
  ov = document.createElement('div'); ov.id = 'rec-result';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2100;overflow-y:auto;background:rgba(14,17,22,0.95);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px';
  const canShareFile = !!(navigator.canShare && file && navigator.canShare({ files:[file] }));
  ov.innerHTML =
    '<div style="width:100%;max-width:340px;text-align:center">' +
      '<div style="font-family:Antonio,sans-serif;font-size:28px;font-weight:700;color:#F5F1EA;margin-bottom:4px">Your clip is ready</div>' +
      '<div style="font-size:13px;color:#A1A1AA;margin-bottom:16px">Share it or download to post anywhere.</div>' +
      '<video src="' + url + '" controls playsinline style="width:100%;border-radius:10px;background:#000;margin-bottom:18px"></video>' +
      (canShareFile ? '<button id="rec-share" style="width:100%;background:linear-gradient(135deg,#FF7A1A,#F5C518);color:#0E1116;border:none;padding:16px;font-family:Antonio,sans-serif;font-size:20px;font-weight:700;letter-spacing:2px;cursor:pointer;border-radius:6px;margin-bottom:10px">📲 Share to Social</button>' : '') +
      '<a id="rec-dl" href="' + url + '" download="' + fname + '" style="display:block;width:100%;background:transparent;color:#F5F1EA;border:1px solid #3D4A5C;padding:15px;font-family:Antonio,sans-serif;font-size:18px;font-weight:700;letter-spacing:2px;cursor:pointer;border-radius:6px;text-decoration:none;box-sizing:border-box;margin-bottom:10px">⬇ Download</a>' +
      '<div id="rec-close" style="font-size:13px;color:#A1A1AA;margin-top:8px;cursor:pointer;text-decoration:underline">Close</div>' +
    '</div>';
  document.body.appendChild(ov);
  const close = () => { ov.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  document.getElementById('rec-close').onclick = close;
  if (canShareFile) {
    document.getElementById('rec-share').onclick = async () => {
      try { await navigator.share({ files:[file], title:'Sudden Death Chess', text:'My Sudden Death Chess clip' }); } catch(e) {}
    };
  }
}

// Live on-site verdict effects -- identical look to the recorded reel.
function fxTier(delta, death) {
  if (death) return { kind:'death', label:'\u2620 GAME OVER', flash:'157,43,229', part:'#9D2BE5', n:70, shake:true };
  if (delta >= 2.0) return { kind:'brilliant', label:'BRILLIANT', flash:'245,197,24', part:'#F5C518', n:90, shake:false };
  if (delta >= 0.8) return { kind:'great', label:'GREAT MOVE', flash:'52,211,153', part:'#34D399', n:64, shake:false };
  if (delta <= -1.0) return { kind:'close', label:'CLOSE CALL', flash:'225,29,46', part:'#34D399', n:74, shake:true };
  return { kind:'safe', label:'\u2713 SURVIVED', flash:'52,211,153', part:'#34D399', n:38, shake:false };
}

const WFX = { canvas:null, ctx:null, raf:null, parts:[], rings:[], flash:null, verdict:null };
function webFxCanvas() {
  if (!WFX.canvas) {
    const c = document.createElement('canvas');
    c.id = 'webfx-canvas';
    c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:1400';
    document.body.appendChild(c);
    WFX.canvas = c; WFX.ctx = c.getContext('2d');
  }
  if (WFX.canvas.width !== window.innerWidth || WFX.canvas.height !== window.innerHeight) {
    WFX.canvas.width = window.innerWidth; WFX.canvas.height = window.innerHeight;
  }
  return WFX.canvas;
}
function webFxStart() { webFxCanvas(); if (!WFX.raf) WFX.raf = requestAnimationFrame(webFxFrame); }

function webFxVerdict(type, square, delta) {
  try {
    webFxCanvas();
    const tier = fxTier(typeof delta === 'number' ? delta : 0, type === 'death');
    const board = document.getElementById('board'); if (!board) return;
    const sqEl = document.querySelector('#board [data-sq="' + square + '"]');
    let cx, cy, cell;
    if (sqEl) { const r = sqEl.getBoundingClientRect(); cx=r.left+r.width/2; cy=r.top+r.height/2; cell=r.width; }
    else { const r = board.getBoundingClientRect(); cx=r.left+r.width/2; cy=r.top+r.height/2; cell=r.width/8; }
    const now = performance.now();
    WFX.flash = { rgb: tier.flash, start: now };
    WFX.rings.push({ x:cx, y:cy, cell, rgb: tier.flash, start: now });
    const k = cell/60;
    for (let i=0;i<tier.n;i++){ const a=Math.random()*Math.PI*2, sp=(3+Math.random()*11)*k; WFX.parts.push({x:cx,y:cy,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp-2.5*k,life:1,hex:tier.part,sz:cell/10}); }
    WFX.verdict = { kind: tier.kind, label: tier.label, until: now + 1400, death: type === 'death' };
    if (tier.shake) { const g=document.getElementById('s-game'); if (g){ g.classList.add('shatter-shake'); setTimeout(()=>g.classList.remove('shatter-shake'),500); } }
    webFxStart();
  } catch (e) {}
}

function webFxFrame() {
  const ctx = WFX.ctx; if (!ctx) { WFX.raf = null; return; }
  webFxCanvas();
  const W = WFX.canvas.width, H = WFX.canvas.height, now = performance.now();
  const pulse = 0.5 + 0.5*Math.sin(now/150);
  ctx.clearRect(0,0,W,H);
  let active = false;
  const board = document.getElementById('board');
  const br = board ? board.getBoundingClientRect() : null;
  const judging = !!S.judging && !S.gameOver;

  if (judging && br && br.width > 0) {
    active = true;
    const cx = br.left+br.width/2, cy = br.top+br.height/2;
    const g = ctx.createRadialGradient(cx,cy,br.width*0.22,cx,cy,br.width*0.82);
    g.addColorStop(0,'rgba(225,29,46,0)');
    g.addColorStop(1,'rgba(225,29,46,'+(0.16+0.22*pulse).toFixed(3)+')');
    ctx.fillStyle=g; ctx.fillRect(br.left-30,br.top-30,br.width+60,br.height+60);
    ctx.strokeStyle='rgba(255,122,26,'+(0.4+0.6*pulse).toFixed(3)+')';
    ctx.lineWidth=6; ctx.strokeRect(br.left-3,br.top-3,br.width+6,br.height+6);
    ctx.textAlign='center'; ctx.textBaseline='middle';
    const dots='.'.repeat(1+(Math.floor(now/300)%3));
    const hb = 1 + 0.07*pulse;
    ctx.save(); ctx.translate(cx, br.top+br.height+Math.max(26,br.width*0.075)); ctx.scale(hb,hb);
    ctx.fillStyle='rgba(255,122,26,'+(0.6+0.4*pulse).toFixed(3)+')';
    ctx.font='700 '+Math.round(Math.max(20,br.width*0.058))+'px Antonio, sans-serif';
    ctx.fillText('DID IT SURVIVE'+dots, 0, 0); ctx.restore();
  }

  if (WFX.flash) { const t=(now-WFX.flash.start)/700; if(t<1){ctx.fillStyle='rgba('+WFX.flash.rgb+','+(0.4*(1-t)).toFixed(3)+')';ctx.fillRect(0,0,W,H);active=true;} else WFX.flash=null; }
  WFX.rings = WFX.rings.filter(r=>{ const t=(now-r.start)/700; if(t>=1)return false; ctx.strokeStyle='rgba('+r.rgb+','+(1-t).toFixed(3)+')'; ctx.lineWidth=(10*(1-t)+2)*(r.cell/60); ctx.beginPath();ctx.arc(r.x,r.y,r.cell*0.4+t*r.cell*4.0,0,Math.PI*2);ctx.stroke(); active=true; return true; });
  for(let i=WFX.parts.length-1;i>=0;i--){const p=WFX.parts[i];p.x+=p.vx;p.y+=p.vy;p.vy+=0.45*(p.sz/6);p.vx*=0.98;p.life-=0.025;if(p.life<=0){WFX.parts.splice(i,1);continue;}ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=p.hex;ctx.fillRect(p.x-p.sz/2,p.y-p.sz/2,p.sz,p.sz);active=true;}
  ctx.globalAlpha=1;

  if (WFX.verdict && now < WFX.verdict.until && br && br.width > 0) {
    active = true;
    const v = WFX.verdict, vt = (v.until - now)/1400;
    const col = v.death ? '#9D2BE5' : (v.kind==='brilliant' ? '#F5C518' : (v.kind==='close' ? '#FF7A1A' : '#34D399'));
    ctx.strokeStyle = col; ctx.lineWidth = v.death ? 9 : 7;
    ctx.strokeRect(br.left-4,br.top-4,br.width+8,br.height+8);
    ctx.textAlign='center'; ctx.textBaseline='middle';
    const pop = Math.min(1, (1-vt)*4);
    ctx.save(); ctx.translate(br.left+br.width/2, br.top+br.height+Math.max(28,br.width*0.085));
    ctx.scale(0.7+0.35*pop, 0.7+0.35*pop);
    ctx.fillStyle = col; ctx.font='700 '+Math.round(Math.max(26,br.width*0.085))+'px Antonio, sans-serif';
    ctx.fillText(v.label, 0, 0); ctx.restore();
  } else if (WFX.verdict && now >= WFX.verdict.until) { WFX.verdict = null; }

  if (active || judging) WFX.raf = requestAnimationFrame(webFxFrame);
  else { WFX.raf = null; ctx.clearRect(0,0,W,H); }
}

function recGateTick() {
  const n = REC._audioNodes;
  if (!n || !REC.active) return;
  const buf = new Uint8Array(n.analyser.fftSize);
  n.analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i]-128)/128; sum += v*v; }
  const rms = Math.sqrt(sum / buf.length);
  const t = performance.now();
  if (rms > 0.012) { REC._gateOpen = true; REC._gateHold = t + 700; }            // open easily, hold open 700ms
  else if (rms < 0.004 && t > (REC._gateHold || 0)) { REC._gateOpen = false; }    // close only after the hold passes
  n.gate.gain.setTargetAtTime(REC._gateOpen ? 1 : 0, n.ac.currentTime, REC._gateOpen ? 0.008 : 0.18);
  REC._gateRaf = requestAnimationFrame(recGateTick);
}

function recTeardownAudio() {
  if (REC._gateRaf) { cancelAnimationFrame(REC._gateRaf); REC._gateRaf = null; }
  const n = REC._audioNodes; REC._audioNodes = null;
  if (!n) return;
  try { if (sfxBusNode && n.recDest) sfxBusNode.disconnect(n.recDest); } catch (e) {}
  ['aSrc','comp','makeup','gate','analyser'].forEach(k => { try { if (n[k]) n[k].disconnect(); } catch (e) {} });
}

function ensureRecordButton() {
  if (document.getElementById('rec-btn')) return;
  const screen = document.getElementById('s-game'); if (!screen) return;
  const btn = document.createElement('button');
  btn.id = 'rec-btn';
  btn.textContent = '🔴 Create Content';
  btn.style.cssText = 'position:fixed;bottom:18px;right:16px;z-index:1500;background:rgba(225,29,46,0.15);border:1px solid rgba(225,29,46,0.5);color:#E11D2E;padding:9px 14px;border-radius:30px;font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:1px;cursor:pointer;backdrop-filter:blur(6px)';
  btn.onclick = () => { if (REC.active) stopRecording(btn); else startRecording(btn); };
  screen.appendChild(btn);
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
  const _chal = new URLSearchParams(location.search).get('challenge');
  if (_chal) S.joinChallenge = _chal;
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
        if (S.user.no_ads || S.user.is_premium) hideAds();
        show('s-lobby');
      } else {
        localStorage.removeItem('sdc_token');
        S.token = null;
      }
    } catch(e) {}
  }

  if (S.joinChallenge) {
    showSearchingOverlay();
    history.replaceState({}, '', location.pathname);
    if (!S.token) {
      S.guestPending = true;
      if (S.ws && S.ws.readyState === WebSocket.OPEN) wsSend({ type: 'guest' });
    }
    // onAuthed fires join_challenge once the socket is authenticated
  }

  const _ck = new URLSearchParams(location.search).get('checkout');
  if (_ck === 'success') {
    if (S.token) { try { const r = await fetch('/api/users/me', { headers: { 'Authorization': 'Bearer ' + S.token } }); if (r.ok) { S.user = await r.json(); updateNavUser(); if (S.user.no_ads || S.user.is_premium) hideAds(); } } catch(e) {} }
    history.replaceState({}, '', location.pathname);
    showPremiumWelcome();
  } else if (_ck === 'cancel') {
    toast('Checkout canceled \u2014 no charge.');
    history.replaceState({}, '', location.pathname);
  }
})();

// ══════════════════════════════════════════
// FX2 — EXPANDED EFFECT LIBRARY
// Big randomized sets for: good moves, blunders, victory, defeat.
// Self-contained: injects its own CSS, uses one shared particle canvas.
// ══════════════════════════════════════════
let _fx2StyleDone = false;
function fx2Style() {
  if (_fx2StyleDone) return;
  _fx2StyleDone = true;
  const css = `
.fx2-flash{position:fixed;inset:0;z-index:1392;pointer-events:none;opacity:0;animation:fx2FlashA .65s ease-out forwards}
@keyframes fx2FlashA{0%{opacity:var(--fa,.5)}100%{opacity:0}}
.fx2-wash{position:fixed;inset:0;z-index:1391;pointer-events:none;opacity:0;animation:fx2WashA 2.2s ease-out forwards}
@keyframes fx2WashA{0%{opacity:0}18%{opacity:1}100%{opacity:0}}
.fx2-vignette{position:fixed;inset:0;z-index:1391;pointer-events:none;animation:fx2VigA 2.2s ease-out forwards}
@keyframes fx2VigA{0%{box-shadow:inset 0 0 120px 20px rgba(var(--vc),0)}30%{box-shadow:inset 0 0 220px 80px rgba(var(--vc),.55)}100%{box-shadow:inset 0 0 120px 20px rgba(var(--vc),0)}}
.fx2-bigtitle{position:fixed;left:50%;top:40%;z-index:1396;pointer-events:none;font-family:Antonio,sans-serif;font-weight:700;font-size:84px;letter-spacing:4px;text-shadow:0 0 40px currentColor,0 4px 24px rgba(0,0,0,.6);text-align:center;transform:translate(-50%,-50%);animation:fx2BTin .5s cubic-bezier(.2,1.4,.4,1) forwards}
.fx2-bigtitle.out{animation:fx2BTout .5s ease-in forwards}
@keyframes fx2BTin{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}100%{opacity:1;transform:translate(-50%,-50%) scale(1)}}
@keyframes fx2BTout{0%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}}
.fx2-rays{position:fixed;width:300px;height:300px;z-index:1393;pointer-events:none;background:repeating-conic-gradient(var(--bc) 0deg 5deg, transparent 5deg 30deg);-webkit-mask:radial-gradient(circle,#000 0%,transparent 70%);mask:radial-gradient(circle,#000 0%,transparent 70%);opacity:0;animation:fx2RaysA 1.2s ease-out forwards}
@keyframes fx2RaysA{0%{opacity:0;transform:rotate(0) scale(.4)}30%{opacity:.85}100%{opacity:0;transform:rotate(55deg) scale(1.3)}}
.fx2-beams{position:fixed;inset:-50%;z-index:1389;pointer-events:none;background:repeating-conic-gradient(rgba(245,197,24,.16) 0deg 8deg, transparent 8deg 60deg);-webkit-mask:radial-gradient(circle at center,#000 10%,transparent 62%);mask:radial-gradient(circle at center,#000 10%,transparent 62%);animation:fx2BeamsA 3s linear forwards}
@keyframes fx2BeamsA{0%{opacity:0;transform:rotate(0)}15%{opacity:1}100%{opacity:0;transform:rotate(90deg)}}
.fx2-ring{position:fixed;z-index:1393;pointer-events:none;border-radius:50%;border:3px solid rgba(var(--rc),.9);transform:translate(-50%,-50%);animation:fx2RingA .7s ease-out forwards}
@keyframes fx2RingA{0%{width:var(--rs);height:var(--rs);opacity:1}100%{width:calc(var(--rs)*5);height:calc(var(--rs)*5);opacity:0}}
.fx2-float{position:fixed;z-index:1396;pointer-events:none;font-family:Antonio,sans-serif;font-weight:700;font-size:34px;transform:translate(-50%,-50%);text-shadow:0 2px 12px rgba(0,0,0,.5);animation:fx2FloatA 1s ease-out forwards}
@keyframes fx2FloatA{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}25%{opacity:1;transform:translate(-50%,-90%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-230%) scale(1)}}
.fx2-glitch{animation:fx2GlitchA .7s steps(2) both}
@keyframes fx2GlitchA{0%{filter:none;transform:translate(0)}20%{filter:drop-shadow(3px 0 #E11D2E) drop-shadow(-3px 0 #0EA5E9);transform:translate(-3px,1px)}40%{transform:translate(4px,-2px)}55%{filter:drop-shadow(-4px 0 #E11D2E) drop-shadow(4px 0 #0EA5E9);transform:translate(-2px,2px)}75%{transform:translate(2px,-1px)}100%{filter:none;transform:translate(0)}}
.fx2-quake{animation:fx2QuakeA .8s cubic-bezier(.36,.07,.19,.97)}
@keyframes fx2QuakeA{0%,100%{transform:translate(0,0)}10%{transform:translate(-8px,4px)}20%{transform:translate(7px,-5px)}30%{transform:translate(-9px,-3px)}40%{transform:translate(8px,5px)}50%{transform:translate(-6px,3px)}60%{transform:translate(6px,-4px)}70%{transform:translate(-4px,2px)}80%{transform:translate(4px,-2px)}90%{transform:translate(-2px,1px)}}
.fx2-bolt{position:fixed;inset:0;z-index:1395;pointer-events:none;animation:fx2BoltA .42s ease-out forwards}
@keyframes fx2BoltA{0%{opacity:0}10%{opacity:1}30%{opacity:.3}45%{opacity:1}100%{opacity:0}}
.fx2-ink{position:absolute;inset:8%;background:radial-gradient(circle,#070707 58%,rgba(7,7,7,.55) 100%);border-radius:52% 48% 47% 53%/49% 51% 46% 54%;transform:scale(0);z-index:57;pointer-events:none;animation:fx2InkA 1.6s ease-out forwards}
.fx2-ink.spread{inset:16%;animation:fx2InkA 1.5s ease-out both}
@keyframes fx2InkA{0%{transform:scale(0);opacity:.95}55%{transform:scale(1.1);opacity:.95}100%{transform:scale(1.05);opacity:0}}
.fx2-ice{position:absolute;inset:0;z-index:57;pointer-events:none;background:linear-gradient(135deg,rgba(200,240,255,.75),rgba(140,200,255,.45));box-shadow:inset 0 0 12px rgba(255,255,255,.9);opacity:0;animation:fx2IceA .7s ease-out forwards}
.fx2-ice.crack{background:linear-gradient(135deg,rgba(200,240,255,.4),rgba(140,200,255,.2));animation:fx2IceCrack .7s ease-in forwards}
@keyframes fx2IceA{0%{opacity:0;transform:scale(.4)}100%{opacity:1;transform:scale(1)}}
@keyframes fx2IceCrack{0%{opacity:1;transform:scale(1) rotate(0)}60%{transform:scale(1.05) rotate(2deg)}100%{opacity:0;transform:scale(1.2) rotate(-3deg)}}
.fx2-vortex{animation:fx2VortexA 1.1s cubic-bezier(.5,0,.9,.5) forwards}
@keyframes fx2VortexA{0%{transform:rotate(0) scale(1);opacity:1}100%{transform:rotate(900deg) scale(0);opacity:0}}
.fx2-swirl{position:absolute;inset:-20%;z-index:56;pointer-events:none;border-radius:50%;background:conic-gradient(from 0deg,transparent,rgba(225,29,46,.5),transparent,rgba(14,17,22,.6),transparent);animation:fx2SwirlA 1.1s linear forwards}
@keyframes fx2SwirlA{0%{transform:rotate(0) scale(.3);opacity:0}30%{opacity:1}100%{transform:rotate(720deg) scale(1.2);opacity:0}}
.fx2-static{position:absolute;inset:0;z-index:58;pointer-events:none;background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.18) 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,rgba(0,0,0,.15) 0 1px,transparent 1px 2px);mix-blend-mode:overlay;animation:fx2StaticA .65s steps(6) forwards}
@keyframes fx2StaticA{0%{opacity:.9;transform:translateY(0)}50%{opacity:.7;transform:translateY(-3px)}100%{opacity:0;transform:translateY(2px)}}
.fx2-fullcrack{position:fixed;inset:0;z-index:1394;pointer-events:none;opacity:0;animation:fx2CrackA 1.4s ease-out forwards}
.fx2-fullcrack svg{width:100%;height:100%}
@keyframes fx2CrackA{0%{opacity:0}12%{opacity:.95}100%{opacity:0}}
.fx2-gray{animation:fx2GrayA 2s ease-out forwards}
@keyframes fx2GrayA{0%{filter:none}25%{filter:grayscale(1) brightness(.7)}100%{filter:none}}
`;
  const s = document.createElement('style');
  s.id = 'fx2-style';
  s.textContent = css;
  document.head.appendChild(s);
}

// ── shared particle engine ──────────────────
const BFX2 = { canvas:null, ctx:null, raf:null, parts:[] };
function bfx2Canvas() {
  if (!BFX2.canvas) {
    const c = document.createElement('canvas');
    c.id = 'bigfx-canvas';
    c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:1390';
    document.body.appendChild(c);
    BFX2.canvas = c; BFX2.ctx = c.getContext('2d');
  }
  const c = BFX2.canvas;
  if (c.width !== window.innerWidth || c.height !== window.innerHeight) { c.width = window.innerWidth; c.height = window.innerHeight; }
  return c;
}
function bfx2Tick() {
  const ctx = BFX2.ctx; if (!ctx) { BFX2.raf = null; return; }
  const W = BFX2.canvas.width, H = BFX2.canvas.height;
  ctx.clearRect(0,0,W,H);
  const ps = BFX2.parts;
  for (let i = ps.length-1; i >= 0; i--) {
    const p = ps[i];
    p.vx *= (p.drag || 0.99); p.vy += (p.grav || 0);
    p.x += p.vx; p.y += p.vy;
    p.rot = (p.rot || 0) + (p.spin || 0);
    p.life -= p.decay;
    if (p.life <= 0 || p.y > H + 60) { ps.splice(i,1); continue; }
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.shape === 'rect') { const w = p.size, h = p.size * 0.5; ctx.fillRect(-w/2, -h/2, w, h); }
    else if (p.shape === 'star') { ctx.font = '700 ' + p.size + 'px Antonio,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.glyph || '\u2605', 0, 0); }
    else if (p.shape === 'coin') { ctx.scale(Math.abs(Math.cos(p.rot)) * 0.9 + 0.1, 1); ctx.beginPath(); ctx.arc(0,0,p.size/2,0,Math.PI*2); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(120,80,0,.4)'; ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(0,0,p.size/2,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
  }
  if (ps.length) BFX2.raf = requestAnimationFrame(bfx2Tick);
  else { BFX2.raf = null; ctx.clearRect(0,0,W,H); }
}
function bfx2Start() { bfx2Canvas(); if (!BFX2.raf) BFX2.raf = requestAnimationFrame(bfx2Tick); }

// ── emitters ────────────────────────────────
const FX2_CONFETTI = ['#FF7A1A','#F5C518','#34D399','#E11D2E','#F5F1EA','#0EA5E9'];
function bfx2Confetti(durMs) {
  const W = bfx2Canvas().width, end = performance.now() + durMs;
  (function spawn() {
    if (performance.now() > end) return;
    for (let i = 0; i < 6; i++) BFX2.parts.push({ x: Math.random()*W, y: -20, vx: (Math.random()-0.5)*3, vy: 2+Math.random()*3, grav: 0.06, drag: 0.995, rot: Math.random()*6, spin: (Math.random()-0.5)*0.3, size: 8+Math.random()*8, color: FX2_CONFETTI[(Math.random()*FX2_CONFETTI.length)|0], shape: 'rect', life: 1, decay: 0.004 });
    bfx2Start(); setTimeout(spawn, 60);
  })();
}
function bfx2Burst(x, y, color, n) {
  for (let i = 0; i < n; i++) { const a = Math.random()*Math.PI*2, sp = 2+Math.random()*6; BFX2.parts.push({ x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, grav: 0.04, drag: 0.96, size: 4+Math.random()*4, color, shape: 'circle', life: 1, decay: 0.012, rot: 0, spin: 0 }); }
  bfx2Start();
}
function bfx2Fireworks(times, gold) {
  const W = bfx2Canvas().width, H = BFX2.canvas.height; let k = 0;
  (function go() {
    if (k++ >= times) return;
    const cols = gold ? ['#F5C518','#FF7A1A','#FFFFFF'] : ['#F5C518','#34D399','#0EA5E9','#E11D2E','#FF7A1A'];
    bfx2Burst(W*(0.2+Math.random()*0.6), H*(0.16+Math.random()*0.34), cols[(Math.random()*cols.length)|0], 38);
    setTimeout(go, 260+Math.random()*260);
  })();
}
function bfx2Coins(durMs) {
  const W = bfx2Canvas().width, end = performance.now() + durMs;
  (function spawn() {
    if (performance.now() > end) return;
    for (let i = 0; i < 3; i++) BFX2.parts.push({ x: Math.random()*W, y: -20, vx: (Math.random()-0.5)*1.5, vy: 3+Math.random()*3, grav: 0.07, drag: 0.997, rot: Math.random()*6, spin: 0.25+Math.random()*0.2, size: 16+Math.random()*8, color: '#F5C518', shape: 'coin', life: 1, decay: 0.004 });
    bfx2Start(); setTimeout(spawn, 70);
  })();
}
function bfx2StarBurst(x, y, n) {
  for (let i = 0; i < n; i++) { const a = Math.random()*Math.PI*2, sp = 1+Math.random()*5; BFX2.parts.push({ x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp-2, grav: 0.03, drag: 0.97, rot: Math.random()*6, spin: (Math.random()-0.5)*0.3, size: 14+Math.random()*14, color: '#F5C518', shape: 'star', glyph: '\u2605', life: 1, decay: 0.01 }); }
  bfx2Start();
}
function bfx2Embers(durMs, color) {
  const W = bfx2Canvas().width, H = BFX2.canvas.height, end = performance.now() + durMs;
  (function spawn() {
    if (performance.now() > end) return;
    for (let i = 0; i < 4; i++) BFX2.parts.push({ x: Math.random()*W, y: H+10, vx: (Math.random()-0.5)*1, vy: -(1+Math.random()*2.5), grav: -0.01, drag: 0.99, size: 3+Math.random()*4, color: color || '#FF7A1A', shape: 'circle', life: 1, decay: 0.008, rot: 0, spin: 0 });
    bfx2Start(); setTimeout(spawn, 55);
  })();
}
function bfx2Ash(durMs) {
  const W = bfx2Canvas().width, end = performance.now() + durMs;
  (function spawn() {
    if (performance.now() > end) return;
    for (let i = 0; i < 4; i++) BFX2.parts.push({ x: Math.random()*W, y: -10, vx: (Math.random()-0.5)*1.2, vy: 0.6+Math.random()*1.4, grav: 0.01, drag: 0.99, size: 2+Math.random()*4, color: Math.random()<0.5 ? '#6B7280' : '#3D4A5C', shape: 'circle', life: 1, decay: 0.005, rot: 0, spin: 0 });
    bfx2Start(); setTimeout(spawn, 60);
  })();
}
function bfx2Sparks(x, y, color, n) {
  for (let i = 0; i < n; i++) { const a = Math.random()*Math.PI*2, sp = 2+Math.random()*7; BFX2.parts.push({ x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp-1.5, grav: 0.05, drag: 0.95, size: 3+Math.random()*4, color, shape: 'circle', life: 1, decay: 0.02, rot: 0, spin: 0 }); }
  bfx2Start();
}

// ── DOM / CSS helpers ───────────────────────
function fx2SqCenter(square) {
  const board = document.getElementById('board');
  const el = square && document.querySelector('#board [data-sq="' + square + '"]');
  if (el) { const r = el.getBoundingClientRect(); return { x: r.left+r.width/2, y: r.top+r.height/2, cell: r.width }; }
  if (board) { const r = board.getBoundingClientRect(); return { x: r.left+r.width/2, y: r.top+r.height/2, cell: r.width/8 }; }
  return { x: window.innerWidth/2, y: window.innerHeight/2, cell: 48 };
}
function fx2BigTitle(text, color, win) {
  fx2Style();
  const t = document.createElement('div');
  t.className = 'fx2-bigtitle ' + (win ? 'win' : 'loss');
  t.style.color = color; t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 520); }, 1900);
}
function fx2Flash(rgb, a) { fx2Style(); const d = document.createElement('div'); d.className = 'fx2-flash'; d.style.background = 'rgb(' + rgb + ')'; d.style.setProperty('--fa', a || 0.5); document.body.appendChild(d); setTimeout(() => d.remove(), 660); }
function fx2Wash(rgba) { fx2Style(); const d = document.createElement('div'); d.className = 'fx2-wash'; d.style.background = rgba; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }
function fx2Vignette(rgb) { fx2Style(); const d = document.createElement('div'); d.className = 'fx2-vignette'; d.style.setProperty('--vc', rgb); document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }
function fx2Rays(x, y, color) { fx2Style(); const d = document.createElement('div'); d.className = 'fx2-rays'; d.style.left = (x-150)+'px'; d.style.top = (y-150)+'px'; d.style.setProperty('--bc', color); document.body.appendChild(d); setTimeout(() => d.remove(), 1200); }
function fx2Beams() { fx2Style(); const d = document.createElement('div'); d.className = 'fx2-beams'; document.body.appendChild(d); setTimeout(() => d.remove(), 3000); }
function fx2Ring(x, y, cell, rgb) { fx2Style(); const d = document.createElement('div'); d.className = 'fx2-ring'; d.style.left = x+'px'; d.style.top = y+'px'; d.style.setProperty('--rc', rgb); d.style.setProperty('--rs', (cell||48)+'px'); document.body.appendChild(d); setTimeout(() => d.remove(), 700); }
function fx2FloatText(x, y, text, color) { fx2Style(); const d = document.createElement('div'); d.className = 'fx2-float'; d.style.left = x+'px'; d.style.top = y+'px'; d.style.color = color; d.textContent = text; document.body.appendChild(d); setTimeout(() => d.remove(), 1000); }
function fx2GoodText(label) { const t = document.createElement('div'); t.className = 'good-text'; t.textContent = label; document.body.appendChild(t); setTimeout(() => t.remove(), 1000); }
function fx2BrilliantText(label, sub) { const t = document.createElement('div'); t.className = 'brilliant-text'; t.textContent = label; document.body.appendChild(t); const s = document.createElement('div'); s.className = 'brilliant-sub'; s.textContent = sub; document.body.appendChild(s); setTimeout(() => { t.remove(); s.remove(); }, 1600); }
function fx2FullCrack() {
  fx2Style();
  const g = document.getElementById('s-game');
  if (g) { g.classList.add('shatter-shake'); setTimeout(() => g.classList.remove('shatter-shake'), 600); }
  const ov = document.createElement('div'); ov.className = 'fx2-fullcrack';
  const cx = 20+Math.random()*60, cy = 20+Math.random()*40; let paths = ''; const N = 12;
  for (let i = 0; i < N; i++) {
    const ang = (i/N)*Math.PI*2 + Math.random()*0.5; let px = cx, py = cy, d = 'M'+px+','+py; let len = 8+Math.random()*8;
    for (let s = 0; s < 5; s++) { const j = (Math.random()-0.5)*10; px += Math.cos(ang)*len + Math.cos(ang+1.57)*j; py += Math.sin(ang)*len + Math.sin(ang+1.57)*j; d += ' L'+px.toFixed(1)+','+py.toFixed(1); len *= 1.15; }
    paths += '<path d="'+d+'"/>';
  }
  ov.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><g stroke="#fff" stroke-width="0.4" fill="none" opacity="0.85">'+paths+'</g></svg>';
  document.body.appendChild(ov); setTimeout(() => ov.remove(), 1400);
}

// ── NEW BLUNDER EFFECTS (square-localized) ───
function fxGlitch(toSquare) { fx2Style(); const b = document.getElementById('board'); if (b) { b.classList.add('fx2-glitch'); setTimeout(() => b.classList.remove('fx2-glitch'), 700); } const c = fx2SqCenter(toSquare); bfx2Sparks(c.x, c.y, '#E11D2E', 16); }
function fxQuake(toSquare) { fx2Style(); const g = document.getElementById('s-game'); if (g) { g.classList.add('fx2-quake'); setTimeout(() => g.classList.remove('fx2-quake'), 800); } const c = fx2SqCenter(toSquare); for (let i = 0; i < 22; i++) BFX2.parts.push({ x: c.x+(Math.random()-0.5)*c.cell, y: c.y, vx: (Math.random()-0.5)*2, vy: 1+Math.random()*3, grav: 0.12, drag: 0.99, size: 2+Math.random()*3, color: '#6B7280', shape: 'circle', life: 1, decay: 0.01, rot: 0, spin: 0 }); bfx2Start(); }
function fxLightning(toSquare) {
  fx2Style(); const c = fx2SqCenter(toSquare);
  const ov = document.createElement('div'); ov.className = 'fx2-bolt';
  let x = c.x, y = 0, d = 'M'+x+',0';
  while (y < c.y) { y += 20+Math.random()*30; x += (Math.random()-0.5)*40; d += ' L'+x.toFixed(0)+','+y.toFixed(0); }
  d += ' L'+c.x.toFixed(0)+','+c.y.toFixed(0);
  ov.innerHTML = '<svg width="100%" height="100%"><path d="'+d+'" stroke="#E11D2E" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px #E11D2E)"/></svg>';
  document.body.appendChild(ov); fx2Flash('225,29,46', 0.32); bfx2Sparks(c.x, c.y, '#E11D2E', 18); setTimeout(() => ov.remove(), 430);
}
function fxInk(toSquare) {
  fx2Style(); const sq = fxSquareEl(toSquare); if (!sq) return;
  const ink = document.createElement('div'); ink.className = 'fx2-ink'; sq.appendChild(ink);
  const file = toSquare.charCodeAt(0), rank = parseInt(toSquare[1]);
  [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]].forEach(([df,dr], i) => {
    const nf = String.fromCharCode(file+df), nr = rank+dr;
    if (nf < 'a' || nf > 'h' || nr < 1 || nr > 8) return;
    const n = fxSquareEl(nf+nr); if (!n) return;
    const sp = document.createElement('div'); sp.className = 'fx2-ink spread'; sp.style.animationDelay = (0.1+i*0.06)+'s'; n.appendChild(sp);
    setTimeout(() => sp.remove(), 1600);
  });
  setTimeout(() => ink.remove(), 1600);
}
function fxFreeze(toSquare) {
  fx2Style(); const sq = fxSquareEl(toSquare); if (!sq) return;
  const ice = document.createElement('div'); ice.className = 'fx2-ice'; sq.appendChild(ice);
  const pc = sq.querySelector('img.piece'); if (pc) pc.style.filter = 'brightness(1.4) saturate(.3)';
  setTimeout(() => ice.classList.add('crack'), 700);
  setTimeout(() => { ice.remove(); if (pc) pc.style.filter = ''; }, 1400);
}
function fxVortex(toSquare) {
  fx2Style(); const sq = fxSquareEl(toSquare); if (!sq) return;
  const pc = sq.querySelector('img.piece'); if (pc) pc.classList.add('fx2-vortex');
  const sw = document.createElement('div'); sw.className = 'fx2-swirl'; sq.appendChild(sw);
  setTimeout(() => { sw.remove(); if (pc) pc.classList.remove('fx2-vortex'); }, 1100);
}
function fxStatic(toSquare) {
  fx2Style(); const b = document.getElementById('board'); if (!b) return;
  const st = document.createElement('div'); st.className = 'fx2-static'; b.appendChild(st);
  const c = fx2SqCenter(toSquare); bfx2Sparks(c.x, c.y, '#F5F1EA', 14);
  setTimeout(() => st.remove(), 660);
}

// ── VICTORY / DEFEAT DISPATCHERS ────────────
function victoryFx() {
  fx2Style();
  const pool = ['confetti','fireworks','coins','stars','beams','embers'];
  const pick = pool[(Math.random()*pool.length)|0];
  const titles = ['VICTORY','FLAWLESS','DOMINANT','CHAMPION','MASTERCLASS','SURVIVOR'];
  const title = titles[(Math.random()*titles.length)|0];
  const c = fx2SqCenter(null);
  if (pick === 'confetti') bfx2Confetti(3500);
  else if (pick === 'fireworks') bfx2Fireworks(6, true);
  else if (pick === 'coins') bfx2Coins(2800);
  else if (pick === 'stars') { bfx2StarBurst(c.x, c.y, 40); fx2Flash('245,197,24', 0.4); }
  else if (pick === 'beams') { fx2Beams(); bfx2Confetti(2500); }
  else { bfx2Embers(3000, '#F5C518'); }
  fx2BigTitle(title, '#F5C518', true);
}
function defeatFx() {
  fx2Style();
  const pool = ['redwash','ash','crack','gray','smoke','vignette'];
  const pick = pool[(Math.random()*pool.length)|0];
  const titles = ['DEFEATED','CRUSHED','ELIMINATED','GAME OVER','WASTED','FINISHED'];
  const title = titles[(Math.random()*titles.length)|0];
  if (pick === 'redwash') fx2Wash('rgba(225,29,46,0.30)');
  else if (pick === 'ash') bfx2Ash(2600);
  else if (pick === 'crack') fx2FullCrack();
  else if (pick === 'gray') { const g = document.getElementById('s-game'); if (g) { g.classList.add('fx2-gray'); setTimeout(() => g.classList.remove('fx2-gray'), 2000); } }
  else if (pick === 'smoke') { bfx2Embers(2200, '#3D4A5C'); fx2Wash('rgba(14,17,22,0.35)'); }
  else fx2Vignette('225,29,46');
  fx2BigTitle(title, '#E11D2E', false);
}
