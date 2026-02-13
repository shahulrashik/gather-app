const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Sessions
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

// API routes
app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// ─── Event page with dynamic OG meta tags ─────────────
app.get('/event/:slug', async (req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    stmt.bind([req.params.slug]);

    let html = fs.readFileSync(path.join(__dirname, 'views', 'event.html'), 'utf8');

    if (stmt.step()) {
      const event = stmt.getAsObject();
      stmt.free();

      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const d = new Date(event.date + 'T00:00:00');
      const dateStr = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

      const ogTags = `
    <meta property="og:title" content="${event.title}" />
    <meta property="og:description" content="${event.description || `${dateStr} · ${event.location}`}" />
    <meta property="og:url" content="${BASE_URL}/event/${event.slug}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Gather" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${event.title}" />
    <meta name="twitter:description" content="${event.description || `${dateStr} · ${event.location}`}" />
    <title>${event.title} — Gather</title>`;

      html = html.replace('<title>Event — Gather</title>', ogTags);
    } else {
      stmt.free();
    }

    res.send(html);
  } catch {
    res.sendFile(path.join(__dirname, 'views', 'event.html'));
  }
});

// ─── Static page routes ───────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'home.html')));
app.get('/browse', (req, res) => res.sendFile(path.join(__dirname, 'views', 'browse.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'views', 'signup.html')));
app.get('/create', (req, res) => res.sendFile(path.join(__dirname, 'views', 'create.html')));
app.get('/my-events', (req, res) => res.sendFile(path.join(__dirname, 'views', 'my-events.html')));
app.get('/event/:slug/edit', (req, res) => res.sendFile(path.join(__dirname, 'views', 'edit.html')));
app.get('/event/:slug/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/event/:slug/confirmation/:attendeeId', (req, res) => res.sendFile(path.join(__dirname, 'views', 'confirmation.html')));
app.get('/event/:slug/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/event/:slug/checkin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'checkin.html')));
app.get('/cancel/:attendeeId/:token', (req, res) => res.sendFile(path.join(__dirname, 'views', 'cancel.html')));

// Initialize DB and start server
async function start() {
  await getDb();
  app.listen(PORT, () => {
    console.log(`\n  ✦ Gather is running at http://localhost:${PORT}\n`);
  });
}

start().catch(console.error);
