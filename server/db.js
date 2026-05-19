const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/game.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run(`CREATE TABLE IF NOT EXISTS users (
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
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS games (
    id            TEXT    PRIMARY KEY,
    white_id      INTEGER,
    black_id      INTEGER,
    winner_id     INTEGER,
    end_reason    TEXT,
    moves         TEXT    DEFAULT '[]',
    white_rating  INTEGER,
    black_rating  INTEGER,
    white_delta   INTEGER,
    black_delta   INTEGER,
    duration_secs INTEGER,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    ended_at      TEXT
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_rating ON users(rating DESC)`);
});

module.exports = db;
