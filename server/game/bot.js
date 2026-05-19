/**
 * Sudden Death Chess — Bot Player
 * Fills in when no human opponent is available.
 * Makes random-ish legal moves with a small delay to feel human.
 */

const BOT_NAMES = [
  'BlunderBot', 'CastleGhost', 'PawnStorm_AI', 'NightKnight',
  'DeepBlunder', 'RookieBot', 'ForkMaster_AI', 'SilentBishop',
  'ZugzwangBot', 'EndgameAI', 'TacticalGhost', 'CheckMateBot'
];

const PIECE_MOVES = {
  P: (r, c, color, board) => {
    const moves = [], dir = color === 'w' ? -1 : 1;
    if (inB(r+dir,c) && !board[r+dir][c]) {
      moves.push([r+dir,c]);
      const start = color==='w'?6:1;
      if (r===start && !board[r+2*dir][c]) moves.push([r+2*dir,c]);
    }
    [-1,1].forEach(dc => {
      if (inB(r+dir,c+dc) && board[r+dir][c+dc] && board[r+dir][c+dc][0]!==color)
        moves.push([r+dir,c+dc]);
    });
    return moves;
  },
  N: (r, c, color, board) => {
    return [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]
      .map(([dr,dc]) => [r+dr,c+dc])
      .filter(([nr,nc]) => inB(nr,nc) && (!board[nr][nc] || board[nr][nc][0]!==color));
  },
  B: (r, c, color, board) => slide(r,c,color,board,[[1,1],[1,-1],[-1,1],[-1,-1]]),
  R: (r, c, color, board) => slide(r,c,color,board,[[0,1],[0,-1],[1,0],[-1,0]]),
  Q: (r, c, color, board) => slide(r,c,color,board,[[0,1],[0,-1],[1,0],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]),
  K: (r, c, color, board) => {
    return [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
      .map(([dr,dc]) => [r+dr,c+dc])
      .filter(([nr,nc]) => inB(nr,nc) && (!board[nr][nc] || board[nr][nc][0]!==color));
  },
};

function inB(r,c){ return r>=0&&r<8&&c>=0&&c<8; }

function slide(r,c,color,board,dirs) {
  const moves = [];
  dirs.forEach(([dr,dc]) => {
    let nr=r+dr,nc=c+dc;
    while(inB(nr,nc)) {
      if (board[nr][nc]) {
        if (board[nr][nc][0]!==color) moves.push([nr,nc]);
        break;
      }
      moves.push([nr,nc]);
      nr+=dr; nc+=dc;
    }
  });
  return moves;
}

function initBoard() {
  return [
    ['bR','bN','bB','bQ','bK','bB','bN','bR'],
    ['bP','bP','bP','bP','bP','bP','bP','bP'],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    ['wP','wP','wP','wP','wP','wP','wP','wP'],
    ['wR','wN','wB','wQ','wK','wB','wN','wR'],
  ];
}

function getAllMoves(board, color) {
  const moves = [];
  for (let r=0; r<8; r++) {
    for (let c=0; c<8; c++) {
      const p = board[r][c];
      if (p && p[0]===color) {
        const type = p[1];
        const targets = PIECE_MOVES[type] ? PIECE_MOVES[type](r,c,color,board) : [];
        targets.forEach(([tr,tc]) => moves.push({fr:r,fc:c,tr,tc,piece:p}));
      }
    }
  }
  return moves;
}

function applyMove(board, fr, fc, tr, tc) {
  const newBoard = board.map(row => [...row]);
  newBoard[tr][tc] = newBoard[fr][fc];
  newBoard[fr][fc] = null;
  // Pawn promotion
  if (newBoard[tr][tc] && newBoard[tr][tc][1]==='P' && (tr===0||tr===7))
    newBoard[tr][tc] = newBoard[tr][tc][0]+'Q';
  return newBoard;
}

function buildSAN(piece, fr, fc, tr, tc, captured) {
  const files='abcdefgh', ranks='87654321';
  const type = piece[1];
  const prefix = type==='P'?'':type;
  const fromFile = (type==='P'&&captured)?files[fc]:'';
  return `${prefix}${fromFile}${captured?'x':''}${files[tc]}${ranks[tc]}`;
}

class BotPlayer {
  constructor(session, botColor, db) {
    this.session = session;
    this.color = botColor;
    this.db = db;
    this.board = initBoard();
    this.name = BOT_NAMES[Math.floor(Math.random()*BOT_NAMES.length)];
    this.rating = 800 + Math.floor(Math.random()*400); // 800-1200
    this.active = true;
  }

  onMove(from, to) {
    // Update our board when the human moves
    const fc = 'abcdefgh'.indexOf(from[0]);
    const fr = 8 - parseInt(from[1]);
    const tc = 'abcdefgh'.indexOf(to[0]);
    const tr = 8 - parseInt(to[1]);
    this.board = applyMove(this.board, fr, fc, tr, tc);
  }

  scheduleMove() {
    if (!this.active || this.session.over) return;
    // Random delay 1-4 seconds to feel human
    const delay = 1000 + Math.random() * 3000;
    setTimeout(() => this.makeMove(), delay);
  }

  makeMove() {
    if (!this.active || this.session.over) return;
    const moves = getAllMoves(this.board, this.color[0]);
    if (!moves.length) return;

    // Prefer captures, otherwise random
    const captures = moves.filter(m => this.board[m.tr][m.tc]);
    const move = captures.length && Math.random()<0.7
      ? captures[Math.floor(Math.random()*captures.length)]
      : moves[Math.floor(Math.random()*moves.length)];

    const captured = this.board[move.tr][move.tc];
    const san = buildSAN(move.piece, move.fr, move.fc, move.tr, move.tc, captured);

    this.board = applyMove(this.board, move.fr, move.fc, move.tr, move.tc);

    const files='abcdefgh', ranks='87654321';
    const from = files[move.fc]+ranks[move.fr];
    const to   = files[move.tc]+ranks[move.tr];

    // Simulate a small eval change (bots never blunder on purpose)
    const evalAfter = (Math.random()*0.6)-0.3;

    // Send move to the session as if it came from a real player
    this.session.onBotMove({
      from, to, san,
      evalBefore: 0,
      evalAfter,
      color: this.color,
    });
  }

  stop() { this.active = false; }
}

module.exports = { BotPlayer, BOT_NAMES };
