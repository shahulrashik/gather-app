const express = require('express');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { getDb, saveDb } = require('../db');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────

function generateSlug(title) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${base}-${suffix}`;
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Please log in to continue' });
  }
  next();
}

function rowsToObjects(results) {
  if (!results || results.length === 0) return [];
  const columns = results[0].columns;
  return results[0].values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// ─── Events CRUD ──────────────────────────────────────

// Create event
router.post('/events', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const {
      title, description, date, start_time, end_time,
      location, capacity, price, ticket_type,
      cover_gradient, accent_color, custom_slug, status
    } = req.body;

    if (!title || !date || !start_time || !end_time || !location) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const id = uuidv4();
    const user = req.session.user;

    // Handle custom slug
    let slug;
    if (custom_slug && custom_slug.trim()) {
      slug = custom_slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
      // Check uniqueness
      const existing = db.prepare('SELECT id FROM events WHERE slug = ?');
      existing.bind([slug]);
      if (existing.step()) {
        existing.free();
        return res.status(409).json({ error: 'This URL is already taken. Try another one.' });
      }
      existing.free();
    } else {
      slug = generateSlug(title);
    }

    db.run(
      `INSERT INTO events (id, title, description, date, start_time, end_time, location, capacity, price, ticket_type, cover_gradient, accent_color, status, user_id, host_name, host_email, slug, custom_slug)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, title, description || '', date, start_time, end_time, location,
       capacity || 50, price || 0, ticket_type || 'free',
       cover_gradient || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
       accent_color || '#7c3aed',
       status || 'published',
       user.id, user.name, user.email, slug,
       custom_slug ? 1 : 0]
    );
    saveDb();

    res.json({ id, slug });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Update event
router.put('/events/:slug', requireAuth, async (req, res) => {
  try {
    const db = await getDb();

    const eventStmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    eventStmt.bind([req.params.slug]);
    if (!eventStmt.step()) {
      eventStmt.free();
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventStmt.getAsObject();
    eventStmt.free();

    if (event.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const {
      title, description, date, start_time, end_time,
      location, capacity, price, ticket_type,
      cover_gradient, accent_color, status, custom_slug
    } = req.body;

    // Handle slug change
    let newSlug = req.params.slug;
    if (custom_slug !== undefined && custom_slug !== null) {
      const cleaned = custom_slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
      if (cleaned && cleaned !== req.params.slug) {
        const existing = db.prepare('SELECT id FROM events WHERE slug = ? AND id != ?');
        existing.bind([cleaned, event.id]);
        if (existing.step()) {
          existing.free();
          return res.status(409).json({ error: 'This URL is already taken' });
        }
        existing.free();
        newSlug = cleaned;
      }
    }

    db.run(
      `UPDATE events SET title=?, description=?, date=?, start_time=?, end_time=?, location=?, capacity=?, price=?, ticket_type=?, cover_gradient=?, accent_color=?, status=?, slug=? WHERE id=?`,
      [
        title || event.title,
        description !== undefined ? description : event.description,
        date || event.date,
        start_time || event.start_time,
        end_time || event.end_time,
        location || event.location,
        capacity || event.capacity,
        price !== undefined ? price : event.price,
        ticket_type || event.ticket_type,
        cover_gradient || event.cover_gradient,
        accent_color || event.accent_color,
        status || event.status,
        newSlug,
        event.id
      ]
    );
    saveDb();

    res.json({ slug: newSlug });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Delete event
router.delete('/events/:slug', requireAuth, async (req, res) => {
  try {
    const db = await getDb();

    const eventStmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    eventStmt.bind([req.params.slug]);
    if (!eventStmt.step()) {
      eventStmt.free();
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventStmt.getAsObject();
    eventStmt.free();

    if (event.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    db.run('DELETE FROM waitlist WHERE event_id = ?', [event.id]);
    db.run('DELETE FROM attendees WHERE event_id = ?', [event.id]);
    db.run('DELETE FROM events WHERE id = ?', [event.id]);
    saveDb();

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// Get event by slug (public — includes OG data)
router.get('/events/:slug', async (req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    stmt.bind([req.params.slug]);

    if (stmt.step()) {
      const event = stmt.getAsObject();
      const countStmt = db.prepare('SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND cancelled = 0');
      countStmt.bind([event.id]);
      countStmt.step();
      const { count } = countStmt.getAsObject();
      countStmt.free();
      stmt.free();

      // Is current user the owner?
      const isOwner = req.session && req.session.user && req.session.user.id === event.user_id;

      res.json({ ...event, rsvp_count: count, is_owner: isOwner });
    } else {
      stmt.free();
      res.status(404).json({ error: 'Event not found' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// List all published events
router.get('/events', async (req, res) => {
  try {
    const db = await getDb();
    const results = db.exec("SELECT * FROM events WHERE status = 'published' ORDER BY date ASC, start_time ASC");
    res.json(rowsToObjects(results));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get events by logged-in user
router.get('/my-events', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare('SELECT * FROM events WHERE user_id = ? ORDER BY date DESC');
    stmt.bind([req.session.user.id]);
    const events = [];
    while (stmt.step()) {
      events.push(stmt.getAsObject());
    }
    stmt.free();
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// ─── Registration / RSVP ─────────────────────────────

router.post('/events/:slug/register', async (req, res) => {
  try {
    const db = await getDb();
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const eventStmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    eventStmt.bind([req.params.slug]);
    if (!eventStmt.step()) {
      eventStmt.free();
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventStmt.getAsObject();
    eventStmt.free();

    if (event.status === 'cancelled') {
      return res.status(400).json({ error: 'This event has been cancelled' });
    }
    if (event.status === 'draft') {
      return res.status(400).json({ error: 'This event is not yet published' });
    }

    // Check duplicate
    const dupStmt = db.prepare('SELECT id, cancelled FROM attendees WHERE event_id = ? AND email = ?');
    dupStmt.bind([event.id, email]);
    if (dupStmt.step()) {
      const existing = dupStmt.getAsObject();
      dupStmt.free();
      if (!existing.cancelled) {
        return res.status(409).json({ error: 'This email is already registered for this event' });
      }
      // Re-register cancelled attendee
      const qrData = JSON.stringify({ attendeeId: existing.id, eventId: event.id, name, email });
      const qrCode = await QRCode.toDataURL(qrData, { width: 300, margin: 2 });
      db.run('UPDATE attendees SET cancelled = 0, name = ?, qr_code = ?, checked_in = 0 WHERE id = ?', [name, qrCode, existing.id]);
      saveDb();
      return res.json({ id: existing.id, name, email, qr_code: qrCode, event, reactivated: true });
    }
    dupStmt.free();

    // Check capacity
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM attendees WHERE event_id = ? AND cancelled = 0');
    countStmt.bind([event.id]);
    countStmt.step();
    const { count } = countStmt.getAsObject();
    countStmt.free();

    if (count >= event.capacity) {
      return res.status(400).json({ error: 'FULL', isFull: true });
    }

    // Create attendee
    const id = uuidv4();
    const cancelToken = crypto.randomBytes(16).toString('hex');
    const qrData = JSON.stringify({ attendeeId: id, eventId: event.id, name, email });
    const qrCode = await QRCode.toDataURL(qrData, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } });

    db.run(
      'INSERT INTO attendees (id, event_id, name, email, qr_code, cancel_token) VALUES (?, ?, ?, ?, ?, ?)',
      [id, event.id, name, email, qrCode, cancelToken]
    );
    saveDb();

    res.json({ id, name, email, qr_code: qrCode, event, cancel_token: cancelToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register' });
  }
});

// Cancel RSVP
router.post('/attendees/:id/cancel', async (req, res) => {
  try {
    const db = await getDb();
    const { cancel_token } = req.body;

    const stmt = db.prepare('SELECT * FROM attendees WHERE id = ?');
    stmt.bind([req.params.id]);
    if (!stmt.step()) { stmt.free(); return res.status(404).json({ error: 'Not found' }); }
    const attendee = stmt.getAsObject();
    stmt.free();

    if (attendee.cancel_token !== cancel_token) {
      return res.status(403).json({ error: 'Invalid cancellation link' });
    }

    db.run('UPDATE attendees SET cancelled = 1 WHERE id = ?', [req.params.id]);
    saveDb();

    // Check waitlist and promote first person
    const waitStmt = db.prepare('SELECT * FROM waitlist WHERE event_id = ? AND notified = 0 ORDER BY created_at ASC LIMIT 1');
    waitStmt.bind([attendee.event_id]);
    if (waitStmt.step()) {
      const nextInLine = waitStmt.getAsObject();
      waitStmt.free();
      db.run('UPDATE waitlist SET notified = 1 WHERE id = ?', [nextInLine.id]);
      saveDb();
      // In production, send email notification here
    } else {
      waitStmt.free();
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel' });
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

// ─── Waitlist ─────────────────────────────────────────

router.post('/events/:slug/waitlist', async (req, res) => {
  try {
    const db = await getDb();
    const { name, email } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

    const eventStmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    eventStmt.bind([req.params.slug]);
    if (!eventStmt.step()) { eventStmt.free(); return res.status(404).json({ error: 'Event not found' }); }
    const event = eventStmt.getAsObject();
    eventStmt.free();

    // Check duplicate
    const dupStmt = db.prepare('SELECT id FROM waitlist WHERE event_id = ? AND email = ?');
    dupStmt.bind([event.id, email]);
    if (dupStmt.step()) { dupStmt.free(); return res.status(409).json({ error: 'Already on the waitlist' }); }
    dupStmt.free();

    const id = uuidv4();
    db.run('INSERT INTO waitlist (id, event_id, name, email) VALUES (?, ?, ?, ?)', [id, event.id, name, email]);
    saveDb();

    // Count position
    const posStmt = db.prepare('SELECT COUNT(*) as pos FROM waitlist WHERE event_id = ? AND created_at <= (SELECT created_at FROM waitlist WHERE id = ?)');
    posStmt.bind([event.id, id]);
    posStmt.step();
    const { pos } = posStmt.getAsObject();
    posStmt.free();

    res.json({ id, position: pos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join waitlist' });
  }
});

// ─── Dashboard ────────────────────────────────────────

router.get('/events/:slug/attendees', requireAuth, async (req, res) => {
  try {
    const db = await getDb();

    const eventStmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    eventStmt.bind([req.params.slug]);
    if (!eventStmt.step()) { eventStmt.free(); return res.status(404).json({ error: 'Event not found' }); }
    const event = eventStmt.getAsObject();
    eventStmt.free();

    if (event.user_id && event.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'You do not have access to this dashboard' });
    }

    // Attendees
    const attStmt = db.prepare('SELECT id, name, email, checked_in, checked_in_at, cancelled, created_at FROM attendees WHERE event_id = ? ORDER BY created_at DESC');
    attStmt.bind([event.id]);
    const attendees = [];
    while (attStmt.step()) attendees.push(attStmt.getAsObject());
    attStmt.free();

    const active = attendees.filter(a => !a.cancelled);
    const checkedIn = active.filter(a => a.checked_in);

    // Waitlist count
    const wlStmt = db.prepare('SELECT COUNT(*) as wl FROM waitlist WHERE event_id = ?');
    wlStmt.bind([event.id]);
    wlStmt.step();
    const { wl } = wlStmt.getAsObject();
    wlStmt.free();

    // Check-in times for graph
    const checkinTimes = checkedIn.map(a => a.checked_in_at).filter(Boolean);

    res.json({
      event,
      attendees: active,
      total: active.length,
      checked_in: checkedIn.length,
      waitlist_count: wl,
      checkin_times: checkinTimes
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch attendees' });
  }
});

// Export CSV
router.get('/events/:slug/export', requireAuth, async (req, res) => {
  try {
    const db = await getDb();

    const eventStmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    eventStmt.bind([req.params.slug]);
    if (!eventStmt.step()) { eventStmt.free(); return res.status(404).json({ error: 'Event not found' }); }
    const event = eventStmt.getAsObject();
    eventStmt.free();

    if (event.user_id !== req.session.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const attStmt = db.prepare('SELECT name, email, checked_in, checked_in_at, cancelled, created_at FROM attendees WHERE event_id = ? ORDER BY created_at ASC');
    attStmt.bind([event.id]);
    const rows = [];
    while (attStmt.step()) rows.push(attStmt.getAsObject());
    attStmt.free();

    let csv = 'Name,Email,Status,Checked In,Checked In At,Registered At\n';
    rows.forEach(r => {
      const status = r.cancelled ? 'Cancelled' : (r.checked_in ? 'Checked In' : 'Registered');
      csv += `"${r.name}","${r.email}","${status}","${r.checked_in ? 'Yes' : 'No'}","${r.checked_in_at || ''}","${r.created_at}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${event.slug}-attendees.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export' });
  }
});

// Check in attendee
router.post('/attendees/:id/checkin', async (req, res) => {
  try {
    const db = await getDb();
    const stmt = db.prepare('SELECT * FROM attendees WHERE id = ?');
    stmt.bind([req.params.id]);
    if (!stmt.step()) { stmt.free(); return res.status(404).json({ error: 'Not found' }); }
    const attendee = stmt.getAsObject();
    stmt.free();

    if (attendee.checked_in) {
      return res.json({ message: 'Already checked in', attendee });
    }

    const now = new Date().toISOString();
    db.run('UPDATE attendees SET checked_in = 1, checked_in_at = ? WHERE id = ?', [now, req.params.id]);
    saveDb();

    res.json({ message: 'Checked in successfully', attendee: { ...attendee, checked_in: 1, checked_in_at: now } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to check in' });
  }
});

// QR check-in
router.post('/checkin/qr', async (req, res) => {
  try {
    const db = await getDb();
    const { qrData } = req.body;

    let parsed;
    try { parsed = JSON.parse(qrData); } catch { return res.status(400).json({ error: 'Invalid QR code' }); }

    const { attendeeId } = parsed;
    if (!attendeeId) return res.status(400).json({ error: 'Invalid QR code data' });

    const stmt = db.prepare('SELECT a.*, e.title as event_title FROM attendees a JOIN events e ON a.event_id = e.id WHERE a.id = ?');
    stmt.bind([attendeeId]);
    if (!stmt.step()) { stmt.free(); return res.status(404).json({ error: 'Attendee not found' }); }
    const attendee = stmt.getAsObject();
    stmt.free();

    if (attendee.cancelled) {
      return res.status(400).json({ error: 'This RSVP has been cancelled' });
    }

    const alreadyCheckedIn = attendee.checked_in === 1;
    if (!alreadyCheckedIn) {
      const now = new Date().toISOString();
      db.run('UPDATE attendees SET checked_in = 1, checked_in_at = ? WHERE id = ?', [now, attendeeId]);
      saveDb();
    }

    res.json({
      success: true,
      already_checked_in: alreadyCheckedIn,
      attendee: { id: attendee.id, name: attendee.name, email: attendee.email, event_title: attendee.event_title, checked_in: 1 }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process check-in' });
  }
});

// Waitlist for dashboard
router.get('/events/:slug/waitlist', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    const eventStmt = db.prepare('SELECT * FROM events WHERE slug = ?');
    eventStmt.bind([req.params.slug]);
    if (!eventStmt.step()) { eventStmt.free(); return res.status(404).json({ error: 'Event not found' }); }
    const event = eventStmt.getAsObject();
    eventStmt.free();

    if (event.user_id !== req.session.user.id) return res.status(403).json({ error: 'Not authorized' });

    const wlStmt = db.prepare('SELECT * FROM waitlist WHERE event_id = ? ORDER BY created_at ASC');
    wlStmt.bind([event.id]);
    const waitlist = [];
    while (wlStmt.step()) waitlist.push(wlStmt.getAsObject());
    wlStmt.free();

    res.json(waitlist);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch waitlist' });
  }
});

module.exports = router;
