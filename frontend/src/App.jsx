import { useState, useEffect, useCallback } from "react";
import "./App.css";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3001";
const STATUSES = ["Applied", "Interviewing", "Offer", "Rejected"];
const CACHE_KEY = "job_tracker_gmail_cache";

// --- localStorage cache helpers ---

function saveCache(suggestions, gmailEmail) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        suggestions,
        lastSynced: new Date().toISOString(),
        gmailEmail,
      }),
    );
  } catch (e) {
    console.warn("[Cache] Failed to save:", e.message);
  }
}

function loadCache(currentGmailEmail) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    // Invalidate if Gmail account changed
    if (
      currentGmailEmail &&
      cache.gmailEmail &&
      cache.gmailEmail !== currentGmailEmail
    ) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return cache;
  } catch (e) {
    return null;
  }
}

function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch (e) {}
}

// Human-readable relative time: "2 minutes ago", "1 hour ago", etc.
function timeAgo(isoString) {
  if (!isoString) return null;
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

function App() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [gmailFilter, setGmailFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null); // null = idle, string = in-progress message
  const [gmailSuggestions, setGmailSuggestions] = useState([]);
  const [backendUrl, setBackendUrl] = useState(BACKEND_URL);
  const [gmailConfigured, setGmailConfigured] = useState(true);
  const [syncDebug, setSyncDebug] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [lastSynced, setLastSynced] = useState(null); // ISO timestamp of last successful sync
  const [form, setForm] = useState({
    subject: "",
    company: "",
    role: "",
    status: "Applied",
    appliedDate: new Date().toISOString().slice(0, 10),
    notes: "",
    link: "",
  });

  // Derived state — filtered purely on client, no extra network calls
  const filteredApplications = statusFilter
    ? applications.filter((a) => a.status === statusFilter)
    : applications;

  const filteredGmailSuggestions = gmailFilter
    ? gmailSuggestions.filter((s) => s.status === gmailFilter)
    : gmailSuggestions;

  // Filter out suggestions that have already been saved to applications
  const filterOutSaved = useCallback((suggestions, savedApps) => {
    const savedIds = new Set(
      savedApps.flatMap((a) => [a.threadId, a.messageId].filter(Boolean)),
    );
    return suggestions.filter(
      (s) => !savedIds.has(s.threadId) && !savedIds.has(s.messageId),
    );
  }, []);

  async function fetchApplications(suggestionsOverride) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${backendUrl}/api/applications`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setApplications(data);
      // Cross-reference: remove cached suggestions already saved
      const currentSuggestions =
        suggestionsOverride !== undefined ? suggestionsOverride : null;
      if (currentSuggestions !== null) {
        setGmailSuggestions(filterOutSaved(currentSuggestions, data));
      } else {
        setGmailSuggestions((prev) => filterOutSaved(prev, data));
      }
    } catch (e) {
      const msg =
        e.message === "Failed to fetch" || e.name === "TypeError"
          ? "Cannot reach backend. Start it with: cd backend && npm start"
          : e.message;
      setError(msg);
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }

  // On mount: load cache first, then fetch applications to cross-reference
  useEffect(() => {
    const cache = loadCache();
    if (cache && cache.suggestions && cache.suggestions.length > 0) {
      setLastSynced(cache.lastSynced);
      fetchApplications(cache.suggestions);
    } else {
      fetchApplications();
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      setGmailConnected(true);
      setError(null);
      setConnectionStatus({ backend: "ok", gmail: "checking..." });
      fetch(`${BACKEND_URL}/api/auth/gmail/status`)
        .then((r) => r.json())
        .then((d) => {
          setGmailEmail(d.email || null);
          setConnectionStatus({ backend: "ok", gmail: d.email || "connected" });
        })
        .catch((e) =>
          setConnectionStatus({ backend: "failed", error: e.message }),
        );
    }
    const err = params.get("gmail_error");
    const errMsg = params.get("msg");
    if (err) {
      window.history.replaceState({}, "", window.location.pathname);
      let message = "Gmail connection failed.";
      if (err === "config")
        message =
          "Gmail isn't set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to backend/.env (see README), restart the backend, then try Connect Gmail again.";
      else if (err === "denied") message = "Gmail access was denied.";
      else if (err === "redirect_uri_mismatch")
        message =
          errMsg ||
          "Redirect URI mismatch. In Google Cloud Console → Credentials → your OAuth client → set Authorized redirect URI to exactly: http://localhost:3001/api/auth/gmail/callback";
      else if (err === "exchange")
        message = errMsg || "Could not save Gmail connection. Try again.";
      else if (err === "no_code")
        message = "Google did not return a code. Try Connect Gmail again.";
      else if (errMsg) message = errMsg;
      setError(message);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected") === "1") return;
    fetch(`${BACKEND_URL}/api/auth/gmail/status`)
      .then((r) => r.json())
      .then((d) => {
        setGmailConnected(!!d.connected);
        setGmailEmail(d.email || null);
        setConnectionStatus({
          backend: "ok",
          gmail: d.connected
            ? d.email || "connected"
            : "not connected (no tokens)",
        });
      })
      .catch((e) =>
        setConnectionStatus({ backend: "failed", error: e.message }),
      );
  }, []);

  useEffect(() => {
    fetch(`${backendUrl}/api/config`)
      .then((r) => r.json())
      .then((d) => {
        if (d.backendUrl) setBackendUrl(d.backendUrl);
        if (typeof d.gmailConfigured === "boolean")
          setGmailConfigured(d.gmailConfigured);
      })
      .catch(() => setGmailConfigured(false));
  }, []);

  function handleSyncGmail() {
    setSyncStatus("Connecting to Gmail…");
    setError(null);
    setSyncDebug(null);
    setGmailFilter("");

    const es = new EventSource(
      `${backendUrl}/api/gmail/sync/stream?maxMessages=100`,
    );

    es.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "status") {
        setSyncStatus(msg.message);
      } else if (msg.type === "done") {
        es.close();
        const fresh = msg.applications || [];
        // Save to cache before cross-referencing so we persist the full list
        const now = new Date().toISOString();
        saveCache(fresh, gmailEmail);
        setLastSynced(now);
        // Cross-reference against saved applications to hide already-added ones
        setGmailSuggestions(filterOutSaved(fresh, applications));
        setConnectionStatus((prev) => ({
          ...prev,
          lastSync: {
            connected: msg.connected,
            count: fresh.length,
            debug: msg.debug,
          },
        }));
        if (!msg.connected) {
          setGmailConnected(false);
          clearCache();
          setLastSynced(null);
          setError(
            "Gmail isn't connected. Click Connect Gmail, sign in with Google and allow access, then try Sync again.",
          );
        } else {
          setError(null);
        }
        if (msg.debug) setSyncDebug(msg.debug);
        setSyncStatus(null);
      } else if (msg.type === "error") {
        es.close();
        setError(msg.message || "Sync failed");
        setGmailSuggestions([]);
        setSyncStatus(null);
      }
    };

    es.onerror = () => {
      es.close();
      setError("Connection to backend lost during sync.");
      setSyncStatus(null);
    };
  }

  async function addSuggestion(sug) {
    try {
      const res = await fetch(`${backendUrl}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: sug.subject || "",
          company: sug.company,
          role: sug.role,
          status: sug.status,
          appliedDate: sug.appliedDate,
          notes: sug.notes || "",
          link: sug.link || "",
          threadId: sug.threadId || "",
          messageId: sug.messageId || "",
        }),
      });
      if (!res.ok) throw new Error("Failed to add");
      // Remove from state and update cache atomically
      setGmailSuggestions((prev) => {
        const updated = prev.filter((s) => s.messageId !== sug.messageId);
        saveCache(updated, gmailEmail);
        return updated;
      });
      fetchApplications();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addAllSuggestions() {
    // Add only what's currently visible (respects active filter)
    await Promise.all(
      filteredGmailSuggestions.map((sug) => addSuggestion(sug)),
    );
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function resetForm() {
    setForm({
      subject: "",
      company: "",
      role: "",
      status: "Applied",
      appliedDate: new Date().toISOString().slice(0, 10),
      notes: "",
      link: "",
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
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error("Update failed");
      } else {
        const res = await fetch(`${backendUrl}/api/applications`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error("Create failed");
      }
      resetForm();
      fetchApplications();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(app) {
    setForm({
      subject: app.subject || "",
      company: app.company,
      role: app.role,
      status: app.status,
      appliedDate: app.appliedDate || "",
      notes: app.notes || "",
      link: app.link || "",
    });
    setEditingId(app.id);
    setShowForm(true);
  }

  async function handleDelete(id) {
    if (!confirm("Remove this application?")) return;
    try {
      const res = await fetch(`${backendUrl}/api/applications/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      fetchApplications();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Job Application Tracker</h1>
        <p className="tagline">Keep your job search organized</p>
      </header>

      {lastSynced && (
        <div className="card connection-status">
          Last synced: {timeAgo(lastSynced)}
          {gmailSuggestions.length > 0 &&
            ` · ${gmailSuggestions.length} suggestions waiting`}
        </div>
      )}

      <div className="toolbar">
        {gmailConnected ? (
          <>
            <span className="gmail-status">
              <span className="gmail-email">
                {gmailEmail ? `Connected as ${gmailEmail}` : "Connected"}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSyncGmail}
                disabled={!!syncStatus}
              >
                {syncStatus ? "Syncing…" : "Sync from Gmail"}
              </button>
            </span>
            {syncStatus && (
              <span className="sync-status-text">{syncStatus}</span>
            )}
          </>
        ) : (
          <span className="gmail-connect-wrap">
            {!gmailConfigured && (
              <span className="gmail-not-configured">
                Gmail not set up — add credentials to backend/.env (see README)
                and restart backend.
              </span>
            )}
            <a
              href={`${backendUrl}/api/auth/gmail?frontend=${encodeURIComponent(window.location.origin)}`}
              className="btn btn-secondary"
              style={{ textDecoration: "none", display: "inline-block" }}
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

      {syncDebug && gmailSuggestions.length === 0 && !syncStatus && (
        <div className="card sync-debug">
          <strong>Sync debug:</strong> Listed {syncDebug.step1_list} messages
          from Gmail.
          {syncDebug.step2_strict !== undefined &&
            ` Strict parsing: ${syncDebug.step2_strict}.`}
          {syncDebug.step4_fallback_parsed !== undefined &&
            ` Lenient: ${syncDebug.step4_fallback_parsed}.`}
          {syncDebug.error && ` Error: ${syncDebug.error}`}
          {syncDebug.step1_list === 0 &&
            " Make sure you're connected (Connect Gmail) and inbox has mail in last 90 days."}
        </div>
      )}

      {showForm && (
        <section className="card form-card">
          <h2>{editingId ? "Edit application" : "New application"}</h2>
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
                <select
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
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
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetForm}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {editingId ? "Save changes" : "Add application"}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="content">
        {/* Gmail suggestions panel */}
        <section className="card gmail-card">
          <div className="gmail-header">
            <h2>From your inbox</h2>
            <div className="section-header-controls">
              {gmailSuggestions.length > 0 && (
                <select
                  value={gmailFilter}
                  onChange={(e) => setGmailFilter(e.target.value)}
                  className="filter-select filter-select-sm"
                  aria-label="Filter Gmail suggestions by status"
                >
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              {filteredGmailSuggestions.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={addAllSuggestions}
                >
                  Add all ({filteredGmailSuggestions.length})
                </button>
              )}
            </div>
          </div>

          {gmailSuggestions.length > 0 ? (
            filteredGmailSuggestions.length > 0 ? (
              <ul className="suggestion-list">
                {filteredGmailSuggestions.map((sug) => {
                  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${sug.threadId || sug.messageId}`;
                  return (
                    <li
                      key={sug.messageId || `${sug.company}-${sug.role}`}
                      className="email-card"
                    >
                      <div className="email-card-left">
                        <div className="email-card-title">
                          {sug.subject || sug.role}
                        </div>
                        <div className="email-card-company">{sug.company}</div>
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
                      </div>
                      <div className="email-card-right">
                        <span
                          className={`status status-${sug.status.toLowerCase()}`}
                        >
                          {sug.status}
                        </span>
                        <a
                          href={gmailUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                        >
                          📧 Gmail
                        </a>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => addSuggestion(sug)}
                        >
                          Add
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted">
                No {gmailFilter} emails found. Try a different filter.
              </p>
            )
          ) : (
            <p className="muted">
              Sync from Gmail to see job application emails here
            </p>
          )}
        </section>

        {/* Saved applications panel */}
        <section className="list-section">
          <div className="section-header">
            <h2>Your applications</h2>
            <div className="section-header-controls">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="filter-select filter-select-sm"
                aria-label="Filter applications by status"
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <p className="muted">Loading…</p>
          ) : filteredApplications.length === 0 ? (
            <p className="muted">
              {statusFilter
                ? `No ${statusFilter} applications. Try a different filter.`
                : "No applications yet. Add one to get started."}
            </p>
          ) : (
            <ul className="application-list">
              {filteredApplications.map((app) => (
                <li key={app.id} className="email-card">
                  <div className="email-card-left">
                    <div className="email-card-title">
                      {app.subject || app.role}
                    </div>
                    <div className="email-card-company">{app.company}</div>
                    {app.aiActionItems && app.aiActionItems.length > 0 && (
                      <div className="suggestion-actions">
                        <div className="actions-label">Action items</div>
                        <ul className="actions-list">
                          {app.aiActionItems.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="email-card-meta">
                      Applied: {app.appliedDate}
                      {app.notes && (
                        <span className="notes"> · {app.notes}</span>
                      )}
                    </div>
                  </div>
                  <div className="email-card-right">
                    <span
                      className={`status status-${app.status.toLowerCase()}`}
                    >
                      {app.status}
                    </span>
                    {(app.threadId || app.messageId) && (
                      <a
                        href={`https://mail.google.com/mail/u/0/#inbox/${app.threadId || app.messageId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                      >
                        📧 Gmail
                      </a>
                    )}
                    {app.link && (
                      <a
                        href={app.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm"
                      >
                        🔗 Job
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => startEdit(app)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm danger"
                      onClick={() => handleDelete(app.id)}
                    >
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
