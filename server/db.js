const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/game.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    UNIQUE NOT NULL COLLATE NOCASE,
    password    TEXT    NOT NULL,
    rating      INTEGER NOT NULL DEFAULT 1200,
    peak_rating INTEGER NOT NULL DEFAULT 1200,
    wins        INTEGER NOT NULL DEFAULT 0,
    losses      INTEGER NOT NULL DEFAULT 0,
    games       INTEGER NOT NULL DEFAULT 0,
    no_ads      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS games (
    id            TEXT    PRIMARY KEY,
    white_id      INTEGER REFERENCES users(id),
    black_id      INTEGER REFERENCES users(id),
    winner_id     INTEGER REFERENCES users(id),
    end_reason    TEXT,
    moves         TEXT    DEFAULT '[]',
    white_rating  INTEGER,
    black_rating  INTEGER,
    white_delta   INTEGER,
    black_delta   INTEGER,
    duration_secs INTEGER,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC);
  CREATE INDEX IF NOT EXISTS idx_games_players ON games(white_id, black_id);
`);

module.exports = db;
