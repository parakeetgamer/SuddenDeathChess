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

function safeUser(u) {
  return { id: u.id, username: u.username, rating: u.rating, peak_rating: u.peak_rating, wins: u.wins, losses: u.losses, games: u.games, no_ads: u.no_ads === 1 };
}
module.exports = router;
