const express = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { getDb, saveDb } = require('../db');

const router = express.Router();

// Helper: generate a URL-friendly slug
function generateSlug(title) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${base}-${suffix}`;
}

// ─── Events ───────────────────────────────────────────

// Create event
router.post('/events', async (req, res) => {
  try {
    const db = await getDb();
    const {
      title, description, date, start_time, end_time,
      location, capacity, price, ticket_type, host_name, host_email
    } = req.body;

    if (!title || !date || !start_time || !end_time || !location) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = uuidv4();
    const slug = generateSlug(title);

    db.run(
      `INSERT INTO events (id, title, description, date, start_time, end_time, location, capacity, price, ticket_type, host_name, host_email, slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, title, description || '', date, start_time, end_time, location,
       capacity || 50, price || 0, ticket_type || 'free', host_name || '', host_email || '', slug]
    );
    saveDb();

    res.json({ id, slug });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Get event by slug
router.get('/events/:slug', async (req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    stmt.bind([req.params.slug]);

    if (stmt.step()) {
      const event = stmt.getAsObject();
      // Get RSVP count
      const countStmt = db.prepare('SELECT COUNT(*) as count FROM attendees WHERE event_id = ?');
      countStmt.bind([event.id]);
      countStmt.step();
      const { count } = countStmt.getAsObject();
      countStmt.free();
      stmt.free();
      res.json({ ...event, rsvp_count: count });
    } else {
      stmt.free();
      res.status(404).json({ error: 'Event not found' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// List all events
router.get('/events', async (req, res) => {
  try {
    const db = await getDb();
    const results = db.exec('SELECT * FROM events ORDER BY date ASC, start_time ASC');
    if (results.length === 0) return res.json([]);

    const columns = results[0].columns;
    const events = results[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => obj[col] = row[i]);
      return obj;
    });
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// ─── Attendees / RSVP ────────────────────────────────

// Register for event
router.post('/events/:slug/register', async (req, res) => {
  try {
    const db = await getDb();
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    // Get event
    const eventStmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    eventStmt.bind([req.params.slug]);
    if (!eventStmt.step()) {
      eventStmt.free();
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventStmt.getAsObject();
    eventStmt.free();

    // Check for duplicate email
    const dupStmt = db.prepare('SELECT id FROM attendees WHERE event_id = ? AND email = ?');
    dupStmt.bind([event.id, email]);
    if (dupStmt.step()) {
      dupStmt.free();
      return res.status(409).json({ error: 'This email is already registered for this event' });
    }
    dupStmt.free();

    // Check capacity
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM attendees WHERE event_id = ?');
    countStmt.bind([event.id]);
    countStmt.step();
    const { count } = countStmt.getAsObject();
    countStmt.free();

    if (count >= event.capacity) {
      return res.status(400).json({ error: 'This event has reached full capacity' });
    }

    // Create attendee
    const id = uuidv4();
    const qrData = JSON.stringify({ attendeeId: id, eventId: event.id, name, email });
    const qrCode = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    db.run(
      'INSERT INTO attendees (id, event_id, name, email, qr_code) VALUES (?, ?, ?, ?, ?)',
      [id, event.id, name, email, qrCode]
    );
    saveDb();

    res.json({ id, name, email, qr_code: qrCode, event });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register' });
  }
});

// Get attendee details
router.get('/attendees/:id', async (req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare('SELECT * FROM attendees WHERE id = ?');
    stmt.bind([req.params.id]);
    if (stmt.step()) {
      const attendee = stmt.getAsObject();
      stmt.free();

      // Also get event info
      const eventStmt = db.prepare('SELECT * FROM events WHERE id = ?');
      eventStmt.bind([attendee.event_id]);
      eventStmt.step();
      const event = eventStmt.getAsObject();
      eventStmt.free();

      res.json({ ...attendee, event });
    } else {
      stmt.free();
      res.status(404).json({ error: 'Attendee not found' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch attendee' });
  }
});

// ─── Dashboard ────────────────────────────────────────

// Get attendees for an event
router.get('/events/:slug/attendees', async (req, res) => {
  try {
    const db = await getDb();

    // Get event
    const eventStmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    eventStmt.bind([req.params.slug]);
    if (!eventStmt.step()) {
      eventStmt.free();
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventStmt.getAsObject();
    eventStmt.free();

    // Get attendees
    const results = db.exec(
      `SELECT id, name, email, checked_in, created_at FROM attendees WHERE event_id = '${event.id}' ORDER BY created_at DESC`
    );

    let attendees = [];
    if (results.length > 0) {
      const columns = results[0].columns;
      attendees = results[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
      });
    }

    // Counts
    const totalStmt = db.prepare('SELECT COUNT(*) as total FROM attendees WHERE event_id = ?');
    totalStmt.bind([event.id]);
    totalStmt.step();
    const { total } = totalStmt.getAsObject();
    totalStmt.free();

    const checkedStmt = db.prepare('SELECT COUNT(*) as checked FROM attendees WHERE event_id = ? AND checked_in = 1');
    checkedStmt.bind([event.id]);
    checkedStmt.step();
    const { checked } = checkedStmt.getAsObject();
    checkedStmt.free();

    res.json({ event, attendees, total, checked_in: checked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch attendees' });
  }
});

// Check in attendee
router.post('/attendees/:id/checkin', async (req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare('SELECT * FROM attendees WHERE id = ?');
    stmt.bind([req.params.id]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(404).json({ error: 'Attendee not found' });
    }
    const attendee = stmt.getAsObject();
    stmt.free();

    if (attendee.checked_in) {
      return res.json({ message: 'Already checked in', attendee });
    }

    db.run('UPDATE attendees SET checked_in = 1 WHERE id = ?', [req.params.id]);
    saveDb();

    res.json({ message: 'Checked in successfully', attendee: { ...attendee, checked_in: 1 } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to check in' });
  }
});

// Check in by QR code data
router.post('/checkin/qr', async (req, res) => {
  try {
    const db = await getDb();
    const { qrData } = req.body;

    let parsed;
    try {
      parsed = JSON.parse(qrData);
    } catch {
      return res.status(400).json({ error: 'Invalid QR code' });
    }

    const { attendeeId } = parsed;
    if (!attendeeId) {
      return res.status(400).json({ error: 'Invalid QR code data' });
    }

    const stmt = db.prepare('SELECT a.*, e.title as event_title FROM attendees a JOIN events e ON a.event_id = e.id WHERE a.id = ?');
    stmt.bind([attendeeId]);
    if (!stmt.step()) {
      stmt.free();
      return res.status(404).json({ error: 'Attendee not found' });
    }
    const attendee = stmt.getAsObject();
    stmt.free();

    const alreadyCheckedIn = attendee.checked_in === 1;

    if (!alreadyCheckedIn) {
      db.run('UPDATE attendees SET checked_in = 1 WHERE id = ?', [attendeeId]);
      saveDb();
    }

    res.json({
      success: true,
      already_checked_in: alreadyCheckedIn,
      attendee: {
        id: attendee.id,
        name: attendee.name,
        email: attendee.email,
        event_title: attendee.event_title,
        checked_in: 1
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process check-in' });
  }
});

module.exports = router;
