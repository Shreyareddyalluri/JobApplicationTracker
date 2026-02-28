# Job Application Tracker

A full-stack web app to track your job applications: company, role, status, date applied, notes, and link to the posting.

## What it does

- **Add** new applications (company, role, status, date, optional link and notes)
- **View** all applications in a list, with status badges (Applied, Interviewing, Offer, Rejected)
- **Filter** by status
- **Edit** or **Delete** applications
- **Gmail integration (optional):** Connect your Gmail, then **Sync from Gmail** to scan recent emails and detect job-related messages. The app infers company, role, and status (Applied / Interviewing / Offer / Rejected) from the email content and lets you add them to the tracker with one click.
- Data is stored in a JSON file on the server (no database setup required)

## Tech stack

- **Backend:** Node.js, Express — REST API that reads/writes to a JSON file
- **Frontend:** React (Vite) — single-page UI that talks to the API

## How to run

### 1. Backend

```bash
cd backend
npm install
npm start
```

The API runs at **http://localhost:3001**.

### 2. Frontend

In a **second terminal**:

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite shows (e.g. **http://localhost:5173** or **http://localhost:5174** if 5173 is in use). The frontend proxies `/api` requests to the backend.

**Connecting frontend and backend:**  
- Start the **backend first** (Terminal 1: `cd backend && npm start`). You should see: `Job Tracker API running at http://localhost:3001`.  
- Then start the **frontend** (Terminal 2: `cd frontend && npm run dev`).  
- Open the frontend URL in your browser. The app will talk to the backend through the proxy; both must be running.  
- If you see "Cannot reach backend", the backend is not running or something else is using port 3001. Stop it with `lsof -i :3001 -t | xargs kill`, then run `npm start` in `backend/` again.

### 3. Gmail integration (optional)

**→ Full step-by-step guide: [GMAIL_SETUP.md](GMAIL_SETUP.md)** — use this to connect your email and auto-pull applications and status from Gmail.

To sync applications from your Gmail inbox:

1. **Google Cloud setup**
   - Go to [Google Cloud Console](https://console.cloud.google.com) and create a project (or use an existing one).
   - Enable the **Gmail API**: APIs & Services → Enable APIs and Services → search “Gmail API” → Enable.
   - Create **OAuth 2.0 credentials**: APIs & Services → Credentials → Create Credentials → OAuth client ID. Choose “Web application” (or “Desktop app” for local testing). Add authorized redirect URI: `http://localhost:3001/api/auth/gmail/callback`.
   - Copy the **Client ID** and **Client secret**.

2. **Backend .env**
   - In `backend/`, copy `.env.example` to `.env`.
   - Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

3. **Use in the app**
   - Restart the backend. In the app, click **Connect Gmail**, sign in with Google, and allow read-only access. Then click **Sync from Gmail** to scan recent emails and see suggested applications you can add to the tracker.

**If "Connect Gmail" shows "Page isn't working" or the connection is refused:**  
- Ensure the **backend is running** (`npm start` in `backend/`). The link goes to `http://localhost:3001`; if nothing is listening there, the browser will show an error.  
- Ensure `backend/.env` exists with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. If they’re missing, you’ll be redirected back to the app with an error message instead.

Parsing is heuristic (keywords and phrases for company, role, status). You can edit any suggested row before adding it.

## Project structure

```
Project/
├── backend/
│   ├── server.js          # Express app + API routes + Gmail OAuth
│   ├── gmail.js           # Gmail API client + email parsing
│   ├── data/
│   │   └── applications.json   # Created when you add first application
│   ├── .env               # GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (optional)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx         # Main UI + state + API calls
│   │   ├── App.css
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js      # Dev server + proxy to backend
│   └── package.json
└── INTERVIEW_NOTES.md      # Talking points for your 1:1
```

## API (for reference)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/applications` | List all (optional `?status=Applied`) |
| GET | `/api/applications/:id` | Get one |
| POST | `/api/applications` | Create (body: company, role, status, appliedDate, notes, link) |
| PATCH | `/api/applications/:id` | Update |
| DELETE | `/api/applications/:id` | Delete |
| GET | `/api/auth/gmail` | Redirect to Google OAuth |
| GET | `/api/auth/gmail/callback` | OAuth callback (used by Google) |
| GET | `/api/auth/gmail/status` | `{ connected: true/false }` |
| POST | `/api/gmail/sync` | Fetch inbox, parse emails, return suggested applications |

---

See **INTERVIEW_NOTES.md** for how to present this project in your recruiter 1:1.
