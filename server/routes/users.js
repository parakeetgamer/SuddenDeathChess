const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('./auth');

const router = express.Router();

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token.' });
  try { req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token.' }); }
}

router.get('/me', auth, (req, res) => {
  db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User not found.' });
    res.json(safeUser(user));
  });
});

router.get('/leaderboard', (req, res) => {
  db.all('SELECT username, rating, wins, losses, games FROM users ORDER BY rating DESC LIMIT 20', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Server error.' });
    res.json(rows);
  });
});

router.get('/:username', (req, res) => {
  db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [req.params.username], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User not found.' });
    res.json(safeUser(user));
  });
});

router.get('/:username/games', (req, res) => {
  db.get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [req.params.username], (err, u) => {
    if (err || !u) return res.status(404).json({ error: 'User not found.' });
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    db.all(
      'SELECT * FROM games WHERE (white_id=? OR black_id=?) AND ended_at IS NOT NULL ORDER BY ended_at ASC LIMIT ?',
      [u.id, u.id, limit],
      (e2, rows) => {
        if (e2) return res.status(500).json({ error: 'Server error.' });
        const games = (rows || []).map(g => {
          const iAmWhite = g.white_id === u.id;
          const myDelta = iAmWhite ? g.white_delta : g.black_delta;
          const myRatingBefore = iAmWhite ? g.white_rating : g.black_rating;
          const oppName = iAmWhite ? g.black_name : g.white_name;
          const oppRating = iAmWhite ? g.black_rating : g.white_rating;
          let result = 'loss';
          if (g.winner_id == null) result = 'draw';
          else if (g.winner_id === u.id) result = 'win';
          const ratingAfter = (typeof myRatingBefore === 'number' && typeof myDelta === 'number')
            ? myRatingBefore + myDelta : myRatingBefore;
          return {
            id: g.id, date: g.ended_at, color: iAmWhite ? 'white' : 'black',
            opponent: oppName || 'Opponent', opponentRating: oppRating,
            result, ratingBefore: myRatingBefore, ratingAfter, delta: myDelta,
            endReason: g.end_reason, durationSecs: g.duration_secs
          };
        });
        res.json(games);
      }
    );
  });
});

function safeUser(u) {
  return { id: u.id, username: u.username, rating: u.rating, peak_rating: u.peak_rating, wins: u.wins, losses: u.losses, games: u.games, no_ads: u.no_ads === 1, is_premium: u.is_premium === 1 };
}

module.exports = router;
