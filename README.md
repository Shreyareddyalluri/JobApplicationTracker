# 🤖 AI Job Application Tracker

An intelligent, personal **AI-powered Job Application Tracker** that integrates with Gmail to automatically detect recruiter emails, classify job updates using LLMs, and keep your application pipeline organized — without manual tracking.

> Built as a personal productivity system to automate job search management using Full‑Stack + GenAI workflows.

---

## ✨ Key Features

### 📬 Gmail Integration

- OAuth-based secure Gmail connection
- One-click **Sync from Gmail**
- Fetches recruiter/application related emails

### 🧠 AI Email Understanding

- LLM analyzes incoming emails
- Extracts:
  - Company name
  - Application status (Applied / Interview / OA / Rejected / Offer)
  - Action items / next steps

- Converts raw emails into structured job updates

### ⚡ Automatic Application Updates

- Creates new applications automatically
- Updates status when follow-up emails arrive
- Eliminates manual data entry

### 📊 Smart Dashboard

- Inbox suggestions derived from Gmail
- Centralized view of applications
- Status-based filtering
- Real-time sync indicators

---

## 🏗️ Architecture

```
Frontend (React + Vite)
        ↓
Node.js / Express Backend
        ↓
Gmail API (OAuth2)
        ↓
LLM Processing Layer
        ↓
Local JSON Storage
```

### Processing Pipeline

```
Sync Gmail
   ↓
Fetch Emails
   ↓
LLM Classification
   ↓
Create / Update Applications
   ↓
Dashboard Updates
```

---

## 🧰 Tech Stack

**Frontend**

- React
- Vite
- CSS

**Backend**

- Node.js
- Express
- Google Gmail API
- OpenAI / LLM API

**Storage (Personal Project)**

- JSON-based persistence
  - `applications.json`
  - `gmail_tokens.json`

---

## 📁 Project Structure

```
JOBAPPLICATIONTRACKER
│
├── backend
│   ├── server.js            # API server
│   ├── gmail.js             # Gmail OAuth + email fetch
│   ├── llm.js               # AI email analysis
│   ├── data/
│   │   ├── applications.json
│   │   └── gmail_tokens.json
│   └── .env
│
├── frontend
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles
│   └── index.html
│
└── README.md
```

---

## 🔐 Environment Setup

Create a `.env` file inside `backend/`:

```env
PORT=5000
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
OPENAI_API_KEY=your_openai_api_key
```

---

## 📬 Gmail OAuth Setup

1. Go to Google Cloud Console
2. Create a new project
3. Enable **Gmail API**
4. Configure OAuth Consent Screen
5. Create OAuth Client (Web Application)
6. Add redirect URI:

```
http://localhost:5000/auth/google/callback
```

---

## 🚀 Running Locally

### Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

```
http://localhost:5173
```

---

## 🧪 Usage Flow

1. Connect Gmail
2. Click **Sync from Gmail**
3. System fetches recruiter emails
4. AI classifies email intent
5. Applications are auto-created or updated
6. Dashboard reflects latest status

---

## 🔒 Security Notes

- OAuth tokens stored locally for personal use
- `.env` and token files are excluded via `.gitignore`
- Read-only Gmail access (`gmail.readonly` scope)

---

## 🧭 Roadmap

- [ ] Follow-up reminders
- [ ] Interview timeline visualization
- [ ] AI job search insights
- [ ] Calendar integration
- [ ] Daily AI job assistant summary

---

## 💡 Motivation

Job search tracking is often manual and fragmented across emails, spreadsheets, and notes. This project explores how LLMs can turn an inbox into a structured, continuously updated career pipeline.

---

## 📌 Status

✅ Gmail OAuth & Sync
✅ AI Email Classification
✅ Automatic Application Updates
✅ Smart Dashboard

---

## 📄 License

Personal project for learning and portfolio purposes.
