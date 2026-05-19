const { Chess } = require('chess.js');

const BOT_NAMES = [
  'BlunderBot', 'CastleGhost', 'PawnStorm_AI', 'NightKnight',
  'DeepBlunder', 'RookieBot', 'ForkMaster_AI', 'SilentBishop',
  'ZugzwangBot', 'EndgameAI', 'TacticalGhost', 'CheckMateBot'
];

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

class BotPlayer {
  constructor(session, botColor) {
    this.session = session;
    this.color = botColor;
    this.chess = new Chess();
    this.name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    this.rating = 800 + Math.floor(Math.random() * 400);
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

  chooseMove(moves) {
    const scored = moves.map(m => {
      let score = 0;
      if (m.captured) score += PIECE_VALUE[m.captured] * 10;
      if (m.san.includes('+')) score += 2;
      if (m.san.includes('#')) score += 1000;
      const testChess = new Chess(this.chess.fen());
      testChess.move({ from: m.from, to: m.to, promotion: 'q' });
      const myPieceValue = PIECE_VALUE[m.piece];
      const opponentMoves = testChess.moves({ verbose: true });
      const recapture = opponentMoves.find(om => om.to === m.to && om.captured);
      if (recapture) {
        const theirValue = PIECE_VALUE[recapture.piece];
        if (theirValue < myPieceValue) {
          score -= (myPieceValue - theirValue) * 8;
        }
      }
      score += Math.random() * 2;
      return { move: m, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(3, scored.length));
    const pick = top[Math.floor(Math.random() * top.length)];
    return pick.move;
  }

  stop() {
    this.active = false;
  }
}

module.exports = { BotPlayer, BOT_NAMES };
