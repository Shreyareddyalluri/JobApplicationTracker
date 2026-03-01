import { useState, useEffect } from 'react';
import './App.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const STATUSES = ['Applied', 'Interviewing', 'Offer', 'Rejected'];

function App() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState(null);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  const [gmailSuggestions, setGmailSuggestions] = useState([]);
  const [backendUrl, setBackendUrl] = useState(BACKEND_URL);
  const [gmailConfigured, setGmailConfigured] = useState(true); // assume true until we know
  const [syncDebug, setSyncDebug] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [form, setForm] = useState({
    subject: '',
    company: '',
    role: '',
    status: 'Applied',
    appliedDate: new Date().toISOString().slice(0, 10),
    notes: '',
    link: '',
  });

  async function fetchApplications() {
    setLoading(true);
    setError(null);
    try {
      const url = statusFilter ? `${backendUrl}/api/applications?status=${encodeURIComponent(statusFilter)}` : `${backendUrl}/api/applications`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setApplications(data);
    } catch (e) {
      const msg = e.message === 'Failed to fetch' || e.name === 'TypeError'
        ? 'Cannot reach backend. Start it with: cd backend && npm start'
        : e.message;
      setError(msg);
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchApplications();
  }, [statusFilter]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail_connected') === '1') {
      window.history.replaceState({}, '', window.location.pathname);
      setGmailConnected(true);
      setError(null);
      setConnectionStatus({ backend: 'ok', gmail: 'checking...' });
      // Fetch email info but don't overwrite gmailConnected—the OAuth callback URL is the ground truth
      fetch('http://localhost:3001/api/auth/gmail/status')
        .then((r) => r.json())
        .then((d) => {
          setGmailEmail(d.email || null);
          setConnectionStatus({ backend: 'ok', gmail: d.email || 'connected' });
        })
        .catch((e) => setConnectionStatus({ backend: 'failed', error: e.message }));
    }
    const err = params.get('gmail_error');
    const errMsg = params.get('msg');
    if (err) {
      window.history.replaceState({}, '', window.location.pathname);
      let message = 'Gmail connection failed.';
      if (err === 'config') message = 'Gmail isn’t set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env (see README), restart the backend, then try Connect Gmail again.';
      else if (err === 'denied') message = 'Gmail access was denied.';
      else if (err === 'redirect_uri_mismatch') message = errMsg || 'Redirect URI mismatch. In Google Cloud Console → Credentials → your OAuth client → set Authorized redirect URI to exactly: http://localhost:3001/api/auth/gmail/callback';
      else if (err === 'exchange') message = errMsg || 'Could not save Gmail connection. Try again.';
      else if (err === 'no_code') message = 'Google did not return a code. Try Connect Gmail again.';
      else if (errMsg) message = errMsg;
      setError(message);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gmail_connected') === '1') return;
    fetch('http://localhost:3001/api/auth/gmail/status')
      .then((r) => r.json())
      .then((d) => {
        setGmailConnected(!!d.connected);
        setGmailEmail(d.email || null);
        setConnectionStatus({ backend: 'ok', gmail: d.connected ? (d.email || 'connected') : 'not connected (no tokens)' });
      })
      .catch((e) => setConnectionStatus({ backend: 'failed', error: e.message }));
  }, []);

  useEffect(() => {
    fetch(`${backendUrl}/api/config`)
      .then((r) => r.json())
      .then((d) => {
        if (d.backendUrl) setBackendUrl(d.backendUrl);
        if (typeof d.gmailConfigured === 'boolean') setGmailConfigured(d.gmailConfigured);
      })
      .catch(() => setGmailConfigured(false));
  }, []);

  async function handleSyncGmail() {
    setGmailSyncing(true);
    setError(null);
    setSyncDebug(null);
    try {
      const res = await fetch(`${backendUrl}/api/gmail/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxMessages: 100 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setGmailSuggestions(data.applications || []);
      setConnectionStatus((prev) => ({
        ...prev,
        lastSync: {
          connected: data.connected,
          count: (data.applications || []).length,
          debug: data.debug,
        },
      }));
      if (!data.connected) {
        setGmailConnected(false);
        setError('Gmail isn’t connected. Click Connect Gmail, sign in with Google and allow access, then try Sync again.');
      } else {
        setError(null);
      }
      if (data.debug) setSyncDebug(data.debug);
    } catch (e) {
      setError(e.message);
      setGmailSuggestions([]);
      setSyncDebug(null);
    } finally {
      setGmailSyncing(false);
    }
  }

  async function addSuggestion(sug) {
    try {
      const res = await fetch(`${backendUrl}/api/applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: sug.subject || '',
          company: sug.company,
          role: sug.role,
          status: sug.status,
          appliedDate: sug.appliedDate,
          notes: sug.notes || '',
          link: sug.link || '',
        }),
      });
      if (!res.ok) throw new Error('Failed to add');
      setGmailSuggestions((prev) => prev.filter((s) => s.messageId !== sug.messageId));
      fetchApplications();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addAllSuggestions() {
    for (const sug of gmailSuggestions) {
      await addSuggestion(sug);
    }
    setGmailSuggestions([]);
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function resetForm() {
    setForm({
      subject: '',
      company: '',
      role: '',
      status: 'Applied',
      appliedDate: new Date().toISOString().slice(0, 10),
      notes: '',
      link: '',
    });
    setEditingId(null);
    setShowForm(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.company.trim() || !form.role.trim()) return;
    try {
      if (editingId) {
        const res = await fetch(`${backendUrl}/api/applications/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error('Update failed');
      } else {
        const res = await fetch(`${backendUrl}/api/applications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error('Create failed');
      }
      resetForm();
      fetchApplications();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(app) {
    setForm({
      subject: app.subject || '',
      company: app.company,
      role: app.role,
      status: app.status,
      appliedDate: app.appliedDate || '',
      notes: app.notes || '',
      link: app.link || '',
    });
    setEditingId(app.id);
    setShowForm(true);
  }

  async function handleDelete(id) {
    if (!confirm('Remove this application?')) return;
    try {
      const res = await fetch(`${backendUrl}/api/applications/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      fetchApplications();
    } catch (err) {
      setError(err.message);
    }
  }

  const filteredList = applications;

  return (
    <div className="app">
      <header className="header">
        <h1>Job Application Tracker</h1>
        <p className="tagline">Keep your job search organized</p>
      </header>

      {connectionStatus && (
        <div className="card connection-status">
          <strong>Status:</strong> Backend: {connectionStatus.backend === 'ok' ? 'OK' : 'Failed'}
          {connectionStatus.error && ` — ${connectionStatus.error}`}
          {connectionStatus.gmail && ` | Gmail: ${connectionStatus.gmail}`}
          {connectionStatus.lastSync && (
            <span>
              {' '}
              | Last sync: connected={String(connectionStatus.lastSync.connected)}, applications={connectionStatus.lastSync.count}
              {connectionStatus.lastSync.debug && connectionStatus.lastSync.debug.step1_list !== undefined &&
                ` (listed ${connectionStatus.lastSync.debug.step1_list} msgs)`}
            </span>
          )}
        </div>
      )}

      <div className="toolbar">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="filter-select"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {gmailConnected ? (
          <span className="gmail-status">
            <span className="gmail-email">{gmailEmail ? `Connected as ${gmailEmail}` : 'Connected'}</span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleSyncGmail}
              disabled={gmailSyncing}
            >
              {gmailSyncing ? 'Checking inbox…' : 'Sync from Gmail'}
            </button>
          </span>
        ) : (
          <span className="gmail-connect-wrap">
            {!gmailConfigured && (
              <span className="gmail-not-configured">
                Gmail not set up — add credentials to backend/.env (see README) and restart backend.
              </span>
            )}
            <a
              href={`${backendUrl}/api/auth/gmail?frontend=${encodeURIComponent(window.location.origin)}`}
              className="btn btn-secondary"
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              Connect Gmail
            </a>
          </span>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
        >
          + Add application
        </button>
      </div>

      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}

      {syncDebug && gmailSuggestions.length === 0 && !gmailSyncing && (
        <div className="card sync-debug">
          <strong>Sync debug:</strong> Listed {syncDebug.step1_list} messages from Gmail.
          {syncDebug.step2_strict !== undefined && ` Strict parsing: ${syncDebug.step2_strict}.`}
          {syncDebug.step4_fallback_parsed !== undefined && ` Lenient: ${syncDebug.step4_fallback_parsed}.`}
          {syncDebug.error && ` Error: ${syncDebug.error}`}
          {syncDebug.step1_list === 0 && ' Make sure you’re connected (Connect Gmail) and inbox has mail in last 90 days.'}
        </div>
      )}

      {showForm && (
        <section className="card form-card">
          <h2>{editingId ? 'Edit application' : 'New application'}</h2>
          <form onSubmit={handleSubmit}>
            <label>
              Subject (optional)
              <input
                name="subject"
                value={form.subject}
                onChange={handleChange}
                placeholder="e.g. Application for Senior Engineer"
              />
            </label>
            <div className="form-row">
              <label>
                Company *
                <input
                  name="company"
                  value={form.company}
                  onChange={handleChange}
                  placeholder="e.g. Acme Inc"
                  required
                />
              </label>
              <label>
                Role *
                <input
                  name="role"
                  value={form.role}
                  onChange={handleChange}
                  placeholder="e.g. Software Engineer"
                  required
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Status
                <select name="status" value={form.status} onChange={handleChange}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Applied date
                <input
                  type="date"
                  name="appliedDate"
                  value={form.appliedDate}
                  onChange={handleChange}
                />
              </label>
            </div>
            <label>
              Job link (optional)
              <input
                name="link"
                type="url"
                value={form.link}
                onChange={handleChange}
                placeholder="https://..."
              />
            </label>
            <label>
              Notes (optional)
              <textarea
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="Interview dates, contact name, etc."
                rows={2}
              />
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={resetForm}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editingId ? 'Save changes' : 'Add application'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="content">
        <section className="card gmail-card">
          <h2>From your inbox — add to tracker</h2>
          {gmailSuggestions.length > 0 ? (
            <>
              <ul className="suggestion-list">
              {gmailSuggestions.map((sug) => {
                const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${sug.threadId || sug.messageId}`;
                return (
                  <li key={sug.messageId || `${sug.company}-${sug.role}`} className="suggestion-card">
                    <div className="suggestion-header">
                      <div className="suggestion-title">
                        {sug.subject || sug.role}
                      </div>
                      <span className={`status status-${sug.status.toLowerCase()}`}>{sug.status}</span>
                    </div>
                    
                    <div className="suggestion-company">
                      {sug.company}
                    </div>

                    {sug.aiActionItems && sug.aiActionItems.length > 0 && (
                      <div className="suggestion-actions">
                        <div className="actions-label">Action items</div>
                        <ul className="actions-list">
                          {sug.aiActionItems.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="suggestion-buttons">
                      <a href={gmailUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" title="Open in Gmail">
                        📧 Gmail
                      </a>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => addSuggestion(sug)}>
                        Add
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addAllSuggestions} style={{ marginTop: '1rem' }}>
                Add all ({gmailSuggestions.length})
              </button>
            </>
          ) : (
            <p className="muted">Sync from Gmail to see job application emails here</p>
          )}
        </section>

        <section className="list-section">
          <h2>Your applications</h2>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : filteredList.length === 0 ? (
            <p className="muted">No applications yet. Add one to get started.</p>
          ) : (
            <ul className="application-list">
              {filteredList.map((app) => (
                <li key={app.id} className="application-card">
                  <div className="app-header">
                    <div className="app-title">
                      {app.subject || app.role}
                    </div>
                    <span className={`status status-${app.status.toLowerCase()}`}>
                      {app.status}
                    </span>
                  </div>

                  <div className="app-company">
                    {app.company}
                  </div>

                  {app.aiActionItems && app.aiActionItems.length > 0 && (
                    <div className="app-actions">
                      <div className="actions-label">Action items</div>
                      <ul className="actions-list">
                        {app.aiActionItems.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="app-meta">
                    Applied: {app.appliedDate}
                    {app.notes && (
                      <span className="notes"> · {app.notes}</span>
                    )}
                  </div>

                  {app.link && (
                    <a href={app.link} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ marginTop: '0.5rem', display: 'inline-block' }}>
                      🔗 View posting
                    </a>
                  )}

                  <div className="app-footer">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(app)}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm danger" onClick={() => handleDelete(app.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;