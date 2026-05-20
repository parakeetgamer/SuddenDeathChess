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
    // Match human rating within +/- 50, clamped to 600-2200
    const hr = humanRating || 1200;
    this.rating = Math.max(600, Math.min(2200, hr + (Math.floor(Math.random() * 100) - 50)));
    // Blunder rate scales inversely with rating: 1200 = 15% blunder chance, 1800 = 5%, 2000+ = 2%
    this.blunderChance = Math.max(0.02, 0.30 - (this.rating - 800) / 4000);
    this.active = true;
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
    const delay = 600 + Math.random() * 1800;
    setTimeout(() => this.makeMove(), delay);
  }

  makeMove() {
    if (!this.active || this.session.over) return;
    if (this.chess.turn() !== this.color) {
      console.error('[BOT] not my turn, expected', this.color, 'but turn is', this.chess.turn());
      return;
    }
    const legalMoves = this.chess.moves({ verbose: true });
    if (legalMoves.length === 0) {
      console.log('[BOT] no legal moves - checkmate or stalemate');
      return;
    }
    const move = this.chooseMove(legalMoves);
    if (!move) return;
    const result = this.chess.move({ from: move.from, to: move.to, promotion: 'q' });
    if (!result) {
      console.error('[BOT] chess.js rejected its own choice', move);
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

  // Evaluate a position from the bot's perspective (positive = good for bot)
  evaluatePosition(chess) {
    if (chess.in_checkmate()) {
      // If opponent is mated, that's amazing; if we are, terrible
      return chess.turn() === this.color ? -10000 : 10000;
    }
    if (chess.in_stalemate() || chess.in_draw()) return 0;
    let score = 0;
    'abcdefgh'.split('').forEach(f => {
      for (let r = 1; r <= 8; r++) {
        const p = chess.get(f + r);
        if (!p) continue;
        const val = PIECE_VALUE[p.type];
        score += (p.color === this.color ? 1 : -1) * val;
      }
    });
    // Small bonus for mobility
    const myMoves = chess.turn() === this.color ? chess.moves().length : 0;
    score += myMoves * 0.05;
    return score;
  }

  // Look at each candidate move; for each, simulate opponent's BEST response
  chooseMove(moves) {
    // Decide if we're going to blunder this turn
    const willBlunder = Math.random() < this.blunderChance;
    if (willBlunder && moves.length > 1) {
      // Pick a random move, weighted toward worse moves
      console.log('[BOT] making a deliberate suboptimal move (rating', this.rating, ')');
      return moves[Math.floor(Math.random() * moves.length)];
    }

    const scored = moves.map(m => {
      // Apply our move
      const test = new Chess(this.chess.fen());
      test.move({ from: m.from, to: m.to, promotion: 'q' });

      // If this is mate-in-1 for us, take it immediately
      if (test.in_checkmate()) {
        return { move: m, score: 10000 };
      }

      // Look at opponent's best response (1-ply lookahead)
      const oppMoves = test.moves({ verbose: true });
      if (oppMoves.length === 0) {
        // Stalemate
        return { move: m, score: 0 };
      }

      let worstForUs = Infinity;
      for (const om of oppMoves) {
        const test2 = new Chess(test.fen());
        test2.move({ from: om.from, to: om.to, promotion: 'q' });
        const evalAfter = this.evaluatePosition(test2);
        if (evalAfter < worstForUs) worstForUs = evalAfter;
      }

      // Add small randomness so bot isn't 100% predictable
      // Strength scales with rating: higher rated bots have less randomness
      const noise = (2200 - this.rating) / 200;  // ~7 at 800, ~0 at 2200
      const score = worstForUs + (Math.random() - 0.5) * noise;
      return { move: m, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Pick from top N where N scales with rating
    // Lower-rated bots pick from a wider range (more variance)
    const topN = Math.max(1, Math.round((2200 - this.rating) / 400));
    const top = scored.slice(0, Math.min(topN, scored.length));
    return top[Math.floor(Math.random() * top.length)].move;
  }

  stop() {
    this.active = false;
  }
}

module.exports = { BotPlayer, BOT_NAMES };
