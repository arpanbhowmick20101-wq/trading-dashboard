
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const PgSession = require('connect-pg-simple')(session);
const path = require('path');

const app = express();

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is missing.');
if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is missing.');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', err => console.error('PostgreSQL pool error:', err.message));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, 'public')));

const auth = (req, res, next) =>
  req.session && req.session.uid
    ? next()
    : res.status(401).json({ error: 'Please sign in first' });

const num = value =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password || password.length < 8) {
      return res.status(400).json({
        error: 'Enter name, email and a password with at least 8 characters'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users(name,email,password) VALUES($1,$2,$3) RETURNING id,name',
      [String(name).trim(), String(email).trim().toLowerCase(), hash]
    );

    req.session.uid = result.rows[0].id;
    req.session.name = result.rows[0].name;

    return res.json({ ok: true, name: result.rows[0].name });
  } catch (error) {
    console.error('Register error:', error.message);
    return res.status(error.code === '23505' ? 400 : 500).json({
      error: error.code === '23505'
        ? 'Email may already be registered'
        : 'Could not create account'
    });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const result = await pool.query(
      'SELECT id,name,password FROM users WHERE email=$1 LIMIT 1',
      [email]
    );

    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    req.session.uid = user.id;
    req.session.name = user.name;

    return res.json({ ok: true, name: user.name });
  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ error: 'Could not sign in' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(error => {
    if (error) return res.status(500).json({ error: 'Could not sign out' });
    res.clearCookie('connect.sid');
    return res.json({ ok: true });
  });
});

// Current user
app.get('/api/me', (req, res) => {
  res.json({
    signedIn: !!(req.session && req.session.uid),
    name: (req.session && req.session.name) || ''
  });
});

// Get trades
app.get('/api/trades', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM trades WHERE user_id=$1
       ORDER BY COALESCE(opened, created_at::text) DESC`,
      [req.session.uid]
    );

    return res.json(result.rows);
  } catch (error) {
    console.error('Get trades error:', error.message);
    return res.status(500).json({ error: 'Could not load trades' });
  }
});

// Add trade
app.post('/api/trades', auth, async (req, res) => {
  try {
    const t = req.body || {};

    const result = await pool.query(
      `INSERT INTO trades(
        user_id,symbol,side,quantity,entry,exit,pnl,opened,closed,
        session,setup,pre_analysis,post_review,emotions,lessons,tags,
        screenshots,checklist
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING id`,
      [
        req.session.uid,
        t.symbol || 'XAUUSD',
        t.side || 'Long',
        num(t.quantity),
        num(t.entry),
        num(t.exit),
        num(t.pnl),
        t.opened || '',
        t.closed || '',
        t.session || '',
        t.setup || '',
        t.pre_analysis || '',
        t.post_review || '',
        t.emotions || '',
        t.lessons || '',
        t.tags || '',
        JSON.stringify(t.screenshots || []),
        JSON.stringify(t.checklist || [])
      ]
    );

    return res.json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    console.error('Create trade error:', error.message);
    return res.status(500).json({ error: 'Could not save trade' });
  }
});

// Update trade
app.put('/api/trades/:id', auth, async (req, res) => {
  try {
    const t = req.body || {};

    const result = await pool.query(
      `UPDATE trades SET
        symbol=$1,side=$2,quantity=$3,entry=$4,exit=$5,pnl=$6,
        opened=$7,closed=$8,session=$9,setup=$10,pre_analysis=$11,
        post_review=$12,emotions=$13,lessons=$14,tags=$15,
        screenshots=$16,checklist=$17
       WHERE id=$18 AND user_id=$19`,
      [
        t.symbol || 'XAUUSD',
        t.side || 'Long',
        num(t.quantity),
        num(t.entry),
        num(t.exit),
        num(t.pnl),
        t.opened || '',
        t.closed || '',
        t.session || '',
        t.setup || '',
        t.pre_analysis || '',
        t.post_review || '',
        t.emotions || '',
        t.lessons || '',
        t.tags || '',
        JSON.stringify(t.screenshots || []),
        JSON.stringify(t.checklist || []),
        req.params.id,
        req.session.uid
      ]
    );

    return res.json({ ok: result.rowCount > 0 });
  } catch (error) {
    console.error('Update trade error:', error.message);
    return res.status(500).json({ error: 'Could not update trade' });
  }
});

// Delete one trade
app.delete('/api/trades/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM trades WHERE id=$1 AND user_id=$2',
      [req.params.id, req.session.uid]
    );

    return res.json({ ok: result.rowCount > 0 });
  } catch (error) {
    console.error('Delete trade error:', error.message);
    return res.status(500).json({ error: 'Could not delete trade' });
  }
});

// Delete all trades
app.delete('/api/trades', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM trades WHERE user_id=$1', [req.session.uid]);
    return res.json({ ok: true });
  } catch (error) {
    console.error('Delete all trades error:', error.message);
    return res.status(500).json({ error: 'Could not delete trades' });
  }
});

// Get rules
app.get('/api/rules', auth, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO rules(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',
      [req.session.uid]
    );

    const result = await pool.query(
      'SELECT * FROM rules WHERE user_id=$1',
      [req.session.uid]
    );

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Get rules error:', error.message);
    return res.status(500).json({ error: 'Could not load rules' });
  }
});

// Save rules
app.put('/api/rules', auth, async (req, res) => {
  try {
    const r = req.body || {};

    await pool.query(
      `INSERT INTO rules(
        user_id,risk,max_trades,daily_loss,losing_streak,rr,sessions,pairs
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(user_id) DO UPDATE SET
        risk=EXCLUDED.risk,
        max_trades=EXCLUDED.max_trades,
        daily_loss=EXCLUDED.daily_loss,
        losing_streak=EXCLUDED.losing_streak,
        rr=EXCLUDED.rr,
        sessions=EXCLUDED.sessions,
        pairs=EXCLUDED.pairs`,
      [
        req.session.uid,
        num(r.risk) || 2,
        num(r.max_trades) || 1,
        num(r.daily_loss) || 2,
        num(r.losing_streak) || 3,
        r.rr || '1:2.5',
        r.sessions || 'London,Asian',
        r.pairs || 'XAUUSD'
      ]
    );

    return res.json({ ok: true });
  } catch (error) {
    console.error('Update rules error:', error.message);
    return res.status(500).json({ error: 'Could not save rules' });
  }
});

// Educational AI journal report (local Ollama only)
app.post('/api/ai/report', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT symbol,side,pnl,session,setup,pre_analysis,post_review,
              emotions,lessons,tags
       FROM trades WHERE user_id=$1
       ORDER BY COALESCE(closed, opened, created_at::text) DESC
       LIMIT 100`,
      [req.session.uid]
    );

    if (!result.rows.length) {
      return res.status(400).json({ error: 'Please add journal entries first.' });
    }

    const safeTrades = result.rows.map(t => ({
      symbol: String(t.symbol || '').slice(0, 20),
      side: String(t.side || '').slice(0, 12),
      pnl: num(t.pnl),
      session: String(t.session || '').slice(0, 40),
      setup: String(t.setup || '').slice(0, 100),
      pre_analysis: String(t.pre_analysis || '').slice(0, 300),
      post_review: String(t.post_review || '').slice(0, 300),
      emotions: String(t.emotions || '').slice(0, 100),
      lessons: String(t.lessons || '').slice(0, 200),
      tags: String(t.tags || '').slice(0, 100)
    }));

    const ai = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:3b',
        stream: false,
        prompt: `Analyze these historical journal entries for educational reflection. Summarize recorded patterns, emotions, repeated mistakes and reflection questions. Do not invent missing data or provide trade signals or execution instructions. Journal data: ${JSON.stringify(safeTrades)}`
      })
    });

    if (!ai.ok) throw new Error('Ollama request failed');

    const data = await ai.json();

    if (!data.response) throw new Error('AI returned an empty report');

    return res.json({ ok: true, report: data.response });
  } catch (error) {
    console.error('Local AI Error:', error.message);
    return res.status(502).json({
      error: 'Local AI is unavailable. Check that Ollama is running on the server machine.'
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await pool.query('SELECT 1');

    app.listen(PORT, () => {
      console.log(
        `TradeFXBook running on port ${PORT}; PostgreSQL connected.`
      );
    });
  } catch (error) {
    console.error('PostgreSQL connection failed:', error.message);
    process.exit(1);
  }
}

startServer();
