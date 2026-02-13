const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDb, saveDb } = require('../db');

const router = express.Router();

// Sign up
router.post('/signup', async (req, res) => {
  try {
    const db = await getDb();
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if email exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?');
    existing.bind([email]);
    if (existing.step()) {
      existing.free();
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    existing.free();

    // Hash password and create user
    const hashedPassword = await bcrypt.hash(password, 10);
    const id = uuidv4();

    db.run(
      'INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)',
      [id, name, email, hashedPassword]
    );
    saveDb();

    // Set session
    req.session.user = { id, name, email };

    res.json({ user: { id, name, email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// Log in
router.post('/login', async (req, res) => {
  try {
    const db = await getDb();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    stmt.bind([email]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = stmt.getAsObject();
    stmt.free();

    // Check password
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Set session
    req.session.user = { id: user.id, name: user.name, email: user.email };

    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

// Log out
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

module.exports = router;
