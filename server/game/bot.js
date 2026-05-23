const { Chess } = require('chess.js');

const BOT_NAMES = [
  'BlunderBot', 'CastleGhost', 'PawnStorm_AI', 'NightKnight',
  'DeepBlunder', 'RookieBot', 'ForkMaster_AI', 'SilentBishop',
  'ZugzwangBot', 'EndgameAI', 'TacticalGhost', 'CheckMateBot'
];

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

class BotPlayer {
  constructor(session, botColor, humanRating) {
    this.session = session;
    this.color = botColor;
    this.chess = new Chess();
    this.name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const hr = humanRating || 1200;
    this.rating = Math.max(600, Math.min(2200, hr + (Math.floor(Math.random() * 100) - 50)));
    // Blunder chance: 25% at 800 rating, 5% at 1800, 2% at 2200
    this.blunderChance = Math.max(0.01, 0.15 - (this.rating - 600) / 8000);
    this.active = true;
    console.log('[BOT] created', this.name, 'rating', this.rating, 'blunder%', (this.blunderChance*100).toFixed(0));
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
    const delay = 800 + Math.random() * Math.random() * 4500; // human-ish: usually quick, sometimes long
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
      if (m.captured) score += PIECE_VALUE[m.captured] * 10;
      if (m.san.includes('+')) score += 2;
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
    const topN = Math.max(1, Math.round((2200 - this.rating) / 400));
    const top = scored.slice(0, Math.min(topN, scored.length));
    return top[Math.floor(Math.random() * top.length)].move;
  }

  stop() {
    this.active = false;
  }
}

module.exports = { BotPlayer, BOT_NAMES };
