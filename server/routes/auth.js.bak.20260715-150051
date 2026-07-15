const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { safeUser } = require('../safeUser');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'sdc-dev-secret-change-in-prod';

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters.' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Only letters, numbers, and underscores.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  try {
    const hash = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken.' });
        return res.status(500).json({ error: 'Server error.' });
      }
      db.get('SELECT * FROM users WHERE id = ?', [this.lastID], (err, user) => {
        if (err) return res.status(500).json({ error: 'Server error.' });
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, user: safeUser(user) });
      });
    });
  } catch(e) {
    res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  db.get('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Server error.' });
    if (!user) return res.status(401).json({ error: 'User not found.' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: safeUser(user) });
  });
});

module.exports = router;
module.exports.JWT_SECRET = JWT_SECRET;
