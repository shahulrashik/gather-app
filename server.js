const express = require('express');
const path = require('path');
const { getDb } = require('./db');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// Page routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

app.get('/create', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'create.html'));
});

app.get('/event/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'event.html'));
});

app.get('/event/:slug/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

app.get('/event/:slug/confirmation/:attendeeId', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'confirmation.html'));
});

app.get('/event/:slug/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/event/:slug/checkin', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'checkin.html'));
});

// Initialize DB and start server
async function start() {
  await getDb();
  app.listen(PORT, () => {
    console.log(`\n  ✦ Gather is running at http://localhost:${PORT}\n`);
  });
}

start().catch(console.error);
