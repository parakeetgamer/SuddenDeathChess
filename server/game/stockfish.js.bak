'use strict';
// Server-side Stockfish (single-threaded WASM) wrapper.
// One engine instance, requests serialized, returns a UCI bestmove for a FEN
// at a target Elo. Falls back to null on any error so callers can use their
// own engine instead of freezing the game.

const path = require('path');

let enginePromise = null;
let queue = Promise.resolve();   // serialize: one search at a time

function engineDir() {
  return path.join(__dirname, '..', '..', 'node_modules', 'stockfish', 'src');
}

function loadEngine() {
  if (enginePromise) return enginePromise;
  enginePromise = new Promise((resolve, reject) => {
    try {
      const dir = engineDir();
      const wasmPath = path.join(dir, 'stockfish-nnue-16-single.wasm');
      const jsPath = path.join(dir, 'stockfish-nnue-16-single.js');
      const init = require(jsPath);
      init()({ locateFile: (f) => (f.indexOf('.wasm') > -1 ? wasmPath : jsPath) })
        .then((engine) => {
          // single-threaded build is driven via onCustomMessage, not postMessage
          engine.onCustomMessage('uci');
          engine.onCustomMessage('isready');
          console.log('[SF] Stockfish engine ready');
          resolve(engine);
        })
        .catch(reject);
    } catch (e) { reject(e); }
  });
  enginePromise.catch(() => { enginePromise = null; }); // allow retry if load failed
  return enginePromise;
}

// Returns a Promise<string|null> resolving to a UCI move like 'e2e4' / 'e7e8q'.
function getBotMove(fen, elo, movetime) {
  const mt = movetime || 400;
  const run = () => new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    loadEngine().then((engine) => {
      const onLine = (line) => {
        if (typeof line !== 'string') return;
        if (line.indexOf('bestmove') === 0) {
          try { engine.removeMessageListener(onLine); } catch (e) {}
          const mv = line.split(/\s+/)[1];
          done(mv && mv !== '(none)' ? mv : null);
        }
      };
      engine.addMessageListener(onLine);
      // SDCX_HARDER_BOTS_V1: Stockfish's UCI_Elo plays well below its nominal
      // number, so compensate above club level and let the top bots off the
      // leash entirely (full strength).
      const target = Math.round(elo || 1500);
      if (target >= 2300) {
        engine.onCustomMessage('setoption name UCI_LimitStrength value false');
      } else if (target >= 1500) {
        const E = Math.max(1320, Math.min(2850, target + 400));
        engine.onCustomMessage('setoption name UCI_LimitStrength value true');
        engine.onCustomMessage('setoption name UCI_Elo value ' + E);
      } else {
        const E = Math.max(1320, Math.min(3190, target));
        engine.onCustomMessage('setoption name UCI_LimitStrength value true');
        engine.onCustomMessage('setoption name UCI_Elo value ' + E);
      }
      engine.onCustomMessage('position fen ' + fen);
      engine.onCustomMessage('go movetime ' + mt);
      setTimeout(() => {
        if (!settled) { try { engine.removeMessageListener(onLine); } catch (e) {} done(null); }
      }, mt + 3000);
    }).catch(() => done(null));
  });
  const r = queue.then(run, run);
  queue = r.catch(() => {});
  return r;
}

module.exports = { getBotMove, loadEngine };
