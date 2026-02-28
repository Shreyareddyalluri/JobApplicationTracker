require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const gmail = require('./gmail');

const app = express();
const PORT = 3001;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const DATA_FILE = path.join(__dirname, 'data', 'applications.json');

// Allow frontend from any localhost port (5173, 5174, 5175, etc.) so proxy works
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    if (origin === FRONTEND_URL) return cb(null, true);
    return cb(null, true);
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());

// Health check so frontend can verify backend is reachable
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Backend is running' });
});

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
  }
}

function readApplications() {
  ensureDataFile();
  const data = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(data);
}

function writeApplications(applications) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(applications, null, 2), 'utf8');
}

// GET all applications (optional ?status= filter)
app.get('/api/applications', (req, res) => {
  try {
    let applications = readApplications();
    const status = req.query.status;
    if (status) applications = applications.filter(a => a.status === status);
    res.json(applications);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load applications' });
  }
});

// GET one application by id
app.get('/api/applications/:id', (req, res) => {
  const applications = readApplications();
  const app_ = applications.find(a => a.id === req.params.id);
  if (!app_) return res.status(404).json({ error: 'Not found' });
  res.json(app_);
});

// POST create new application
app.post('/api/applications', (req, res) => {
  const { company, role, status, appliedDate, notes, link } = req.body;
  if (!company || !role) {
    return res.status(400).json({ error: 'Company and role are required' });
  }
  const applications = readApplications();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const newApp = {
    id,
    company: String(company).trim(),
    role: String(role).trim(),
    status: status || 'Applied',
    appliedDate: appliedDate || new Date().toISOString().slice(0, 10),
    notes: notes ? String(notes).trim() : '',
    link: link ? String(link).trim() : '',
    createdAt: new Date().toISOString(),
  };
  applications.push(newApp);
  writeApplications(applications);
  res.status(201).json(newApp);
});

// PATCH update application
app.patch('/api/applications/:id', (req, res) => {
  const applications = readApplications();
  const index = applications.findIndex(a => a.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  const allowed = ['company', 'role', 'status', 'appliedDate', 'notes', 'link'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) applications[index][key] = req.body[key];
  }
  writeApplications(applications);
  res.json(applications[index]);
});

// DELETE application
app.delete('/api/applications/:id', (req, res) => {
  const applications = readApplications();
  const filtered = applications.filter(a => a.id !== req.params.id);
  if (filtered.length === applications.length) return res.status(404).json({ error: 'Not found' });
  writeApplications(filtered);
  res.status(204).send();
});

// --- Gmail integration ---

// So the frontend can build the Connect Gmail link (avoids proxy issues)
app.get('/api/config', (req, res) => {
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${PORT}`;
  res.json({ backendUrl, frontendUrl: FRONTEND_URL, gmailConfigured: gmail.isGmailConfigured() });
});

// Redirect user to Google OAuth (always send a valid HTTP response)
// Optional ?frontend=http://localhost:5176 so we redirect back to the port you're actually using
app.get('/api/auth/gmail', (req, res) => {
  const returnTo = req.query.frontend && /^https?:\/\/localhost(:\d+)?$/.test(req.query.frontend)
    ? req.query.frontend.replace(/\/$/, '')
    : FRONTEND_URL;
  if (!gmail.isGmailConfigured()) {
    res.status(302).setHeader('Location', `${returnTo}?gmail_error=config`).end();
    return;
  }
  try {
    const url = gmail.getAuthUrl(returnTo);
    if (url && typeof url === 'string') {
      res.status(302).setHeader('Location', url).end();
    } else {
      res.status(302).setHeader('Location', `${returnTo}?gmail_error=config`).end();
    }
  } catch (err) {
    res.status(302).setHeader('Location', `${returnTo}?gmail_error=config`).end();
  }
});

// OAuth callback: exchange code for tokens, redirect back to app (use state = frontend URL if present)
app.get('/api/auth/gmail/callback', async (req, res) => {
  const returnTo = req.query.state && /^https?:\/\/localhost(:\d+)?$/.test(req.query.state)
    ? req.query.state.replace(/\/$/, '')
    : FRONTEND_URL;
  const redirect = (key, extra) => {
    const q = extra ? `&msg=${encodeURIComponent(extra)}` : '';
    res.status(302).setHeader('Location', `${returnTo}?gmail_error=${key}${q}`).end();
  };
  const redirectOk = () => {
    res.status(302).setHeader('Location', `${returnTo}?gmail_connected=1`).end();
  };
  console.log('[Gmail] Callback hit. state=', req.query.state, 'returnTo=', returnTo, 'error=', req.query.error);
  if (req.query.error) {
    const errMsg = req.query.error === 'redirect_uri_mismatch'
      ? 'Redirect URI mismatch. In Google Cloud Console, set Authorized redirect URI to: http://localhost:3001/api/auth/gmail/callback'
      : req.query.error_description || req.query.error;
    console.log('[Gmail] OAuth error from Google:', errMsg);
    redirect(req.query.error === 'redirect_uri_mismatch' ? 'redirect_uri_mismatch' : 'denied', errMsg);
    return;
  }
  if (!req.query.code) {
    console.log('[Gmail] No code in callback');
    redirect('no_code');
    return;
  }
  try {
    await gmail.saveTokensFromCode(req.query.code);
    console.log('[Gmail] Tokens saved successfully');
    redirectOk();
  } catch (err) {
    console.error('[Gmail] Token exchange failed:', err.message);
    redirect('exchange', err.message || 'Token exchange failed');
  }
});

// Check if Gmail is connected and get connected email
app.get('/api/auth/gmail/status', async (req, res) => {
  const tokens = gmail.getStoredTokens();
  if (!tokens) {
    return res.json({ connected: false, email: null });
  }
  try {
    const email = await gmail.getConnectedEmail();
    res.json({ connected: !!email, email: email || null });
  } catch {
    res.json({ connected: true, email: null });
  }
});

// Sync from Gmail: fetch recent emails, parse, return suggested applications
app.post('/api/gmail/sync', async (req, res) => {
  try {
    const result = await gmail.fetchAndParseEmails(req.body.maxMessages || 100, { debug: true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Gmail sync failed', connected: false });
  }
});

app.listen(PORT, () => {
  ensureDataFile();
  console.log(`Job Tracker API running at http://localhost:${PORT}`);
});
