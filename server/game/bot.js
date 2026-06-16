const { Chess } = require('chess.js');

// Opponent archetypes — each game rolls one for real variety in name,
// strength, and play style.
const ARCHETYPES = [
  { key: 'beginner', label: 'Beginner', ratingMin: 700,  ratingMax: 1000, blunder: 0.18, capWeight: 1, names:
    ['RookieRoger', 'OopsAllPawns', 'BlunderBot', 'NewbNigel', 'PawnPusher', 'CoffeeHouse'] },
  { key: 'aggressive', label: 'Aggressive', ratingMin: 1000, ratingMax: 1500, blunder: 0.10, capWeight: 3, names:
    ['PawnStorm_AI', 'GambitGremlin', 'TacticalGhost', 'ForkMaster_AI', 'SacAttack', 'WildBishop'] },
  { key: 'solid', label: 'Solid', ratingMin: 1200, ratingMax: 1700, blunder: 0.05, capWeight: 1, names:
    ['FortressBot', 'StoneWall_AI', 'CastleGhost', 'SilentBishop', 'ProphylaxisPro', 'SolidSam'] },
  { key: 'sharp', label: 'Sharp', ratingMin: 1600, ratingMax: 2100, blunder: 0.025, capWeight: 2, names:
    ['DeepNightmare', 'EndgameAI', 'ZugzwangBot', 'CheckMateBot', 'NightKnight', 'CalcMonster'] },
];

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const BOT_NAMES = ARCHETYPES.flatMap(a => a.names); // kept for compatibility

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

class BotPlayer {
  constructor(session, botColor, humanRating) {
    this.session = session;
    this.color = botColor;
    this.chess = new Chess();

    // Roll an archetype. Bias slightly toward archetypes near the human's level
    // so games are usually competitive, but allow the full spread for variety.
    const hr = humanRating || 1200;
    const arch = pick(ARCHETYPES);
    this.archetype = arch.key;
    this.name = pick(arch.names);
    // Rating: within the archetype's band, nudged toward the human a little.
    const bandMid = (arch.ratingMin + arch.ratingMax) / 2;
    const raw = bandMid * 0.6 + hr * 0.4 + (Math.floor(Math.random() * 200) - 100);
    this.rating = Math.max(arch.ratingMin, Math.min(arch.ratingMax, Math.round(raw)));
    this.strength = this.rating + 200;        // bot plays 200 Elo above the rating it shows
    this.blunderChance = arch.blunder * 0.6;  // tougher: blunders less than its archetype baseline
    this.capWeight = arch.capWeight; // how much it favors captures/aggression
    this.active = true;
    console.log('[BOT] created', this.name, '(' + arch.label + ')',
      'rating', this.rating, 'blunder%', (this.blunderChance*100).toFixed(0));
  }

  onMove(from, to) {
    try {
      this.chess.move({ from, to, promotion: 'q' });
    } catch (e) {
      console.error('[BOT] Failed to sync move:', from, to, e.message);
    }
  }

  scheduleMove() {
    if (!this.active || this.session.over) return;
    const delay = Math.min(4800, 800 + Math.random() * Math.random() * 4500); // human-ish, capped under the 5s clock
    setTimeout(() => {
      try {
        this.makeMove();
      } catch (e) {
        console.error('[BOT] makeMove crashed:', e.message, e.stack);
        // Fallback: make any legal move so game doesn't freeze
        try {
          const moves = this.chess.moves({ verbose: true });
          if (moves.length > 0) {
            const m = moves[Math.floor(Math.random() * moves.length)];
            this.chess.move({ from: m.from, to: m.to, promotion: 'q' });
            this.session.onBotMove({
              from: m.from, to: m.to, san: m.san,
              evalBefore: 0, evalAfter: 0,
              color: this.color === 'w' ? 'white' : 'black',
            });
          }
        } catch (e2) {
          console.error('[BOT] fallback also failed:', e2.message);
        }
      }
    }, delay);
  }

  makeMove() {
    if (!this.active || this.session.over) return;
    if (this.chess.turn() !== this.color) return;

    const legalMoves = this.chess.moves({ verbose: true });
    if (legalMoves.length === 0) return;

    let chosen;

    // Decide if we'll blunder this turn
    const willBlunder = Math.random() < this.blunderChance;
    if (willBlunder && legalMoves.length > 2) {
      // Weak (not suicidal) move: pick from the weaker half of scored moves.
      const scored = this.scoreMoves(legalMoves);
      const half = scored.slice(Math.floor(scored.length / 2));
      chosen = half[Math.floor(Math.random() * half.length)].move;
      console.log('[BOT]', this.name, 'making weak move (rating', this.rating, ')');
    } else {
      chosen = this.chooseMove(legalMoves);
    }

    if (!chosen) return;

    const result = this.chess.move({ from: chosen.from, to: chosen.to, promotion: 'q' });
    if (!result) {
      console.error('[BOT] chess.js rejected chosen move', chosen);
      return;
    }

    console.log('[BOT]', this.name, 'plays', result.san);

    this.session.onBotMove({
      from: result.from,
      to: result.to,
      san: result.san,
      evalBefore: 0,
      evalAfter: 0,
      color: this.color === 'w' ? 'white' : 'black',
    });
  }

  scoreMoves(moves) {
    const scored = moves.map(m => {
      let score = 0;
      const cw = this.capWeight || 1; // archetype aggression multiplier
      if (m.captured) score += PIECE_VALUE[m.captured] * 10 * cw;
      if (m.san.includes('+')) score += 2 * cw;
      if (m.san.includes('#')) score += 10000;
      try {
        const test = new Chess(this.chess.fen());
        test.move({ from: m.from, to: m.to, promotion: 'q' });
        const oppMoves = test.moves({ verbose: true });
        const myValue = PIECE_VALUE[m.piece] || 0;
        for (const om of oppMoves) {
          if (om.to === m.to && om.captured) {
            const theirValue = PIECE_VALUE[om.piece] || 0;
            const net = myValue - theirValue;
            if (net > 0) score -= net * 8;
            break;
          }
        }
      } catch (e) {}
      score += Math.random() * 2;
      return { move: m, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  chooseMove(moves) {
    const scored = this.scoreMoves(moves);
    const topN = Math.max(1, Math.round((2200 - this.strength) / 400));
    const top = scored.slice(0, Math.min(topN, scored.length));
    return top[Math.floor(Math.random() * top.length)].move;
  }

  stop() {
    this.active = false;
  }
}

module.exports = { BotPlayer, BOT_NAMES };
