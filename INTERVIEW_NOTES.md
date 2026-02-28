# Interview talking points — Job Application Tracker

Use this when you present the project in your recruiter 1:1. Keep it in simple, non-technical language.

---

## 1. What is it? (30 seconds)

> "I built a **Job Application Tracker** — a small web app where I can record every job I apply to: company name, role, when I applied, and the status — like Applied, Interviewing, Offer, or Rejected. I can add new ones, edit them when I get an update, filter by status, and open the job link if I saved it. It helps me stay organized during my job search."

---

## 2. How it’s built (simple terms)

- **Backend (server):** "The server holds my data in a file. When I add or edit an application, the frontend sends that to the server, and the server saves it. When I open the app, it asks the server for the list and shows it."
- **Frontend (what I see):** "The part in the browser is built with React. It has a form to add or edit applications, a list of all of them, a filter by status, and buttons to edit or delete. Everything I do in the UI triggers a request to the server."

You don’t need to say "REST API" or "CRUD" unless they ask. You can say: "The server exposes endpoints so the frontend can get the list, add one, update one, or delete one."

---

## 3. Where and how you used AI (important)

Be specific and show ownership. Examples:

- **Scaffolding:** "I used an AI assistant to generate the initial structure: the Express server with routes for listing, adding, updating, and deleting applications, and the React app with the form and list. I then adjusted the fields (e.g. added ‘link’ and ‘notes’) and the validation."
- **UI and styling:** "The assistant suggested a dark theme and the layout. I kept what I liked and changed colors and spacing to match what I wanted."
- **Debugging:** "When something didn’t work — for example the filter or the proxy to the backend — I pasted the error or the relevant code and asked the AI to help. It suggested fixes; I chose the one that made sense and tested it."
- **Ownership:** "I decided what the app should do (which statuses, which fields), how the flow works (add → list → edit/delete), and what to keep or change from the AI’s suggestions."

Keep it short: 2–3 concrete examples are enough.

---

## 4. If they ask to see the code

- **Backend:** Open `backend/server.js`. In simple terms: "This file starts the server and defines the routes. For example, when the frontend asks for the list, this part reads the file and sends the data back. When I add a new application, this part appends it and saves the file."
- **Frontend:** Open `frontend/src/App.jsx`. "This is the main screen. It keeps the list of applications in state, loads them from the server when the page loads or when I change the filter, and when I submit the form it either sends a create or an update to the server, then refreshes the list."

You can point to one route in `server.js` and one function in `App.jsx` (e.g. `fetchApplications` or `handleSubmit`) and explain in one sentence what it does.

---

## 5. Checklist before the call

- [ ] Backend and frontend both run without errors (`npm start` in backend, `npm run dev` in frontend).
- [ ] Add 2–3 sample applications so the list isn’t empty when you share the screen.
- [ ] Try: add, edit, filter by status, delete — so you’re comfortable doing it live.
- [ ] Microphone, camera, and screen-sharing work.
- [ ] You can explain in 1–2 minutes: what the app does, how it’s built (server + React), and 2–3 places where AI helped and what you decided.

---

## 6. One-line summary

> "I built a full-stack Job Application Tracker with a Node/Express backend and a React frontend, and I used an AI assistant to speed up scaffolding and debugging while making the product and design decisions myself."

Good luck with your 1:1.
