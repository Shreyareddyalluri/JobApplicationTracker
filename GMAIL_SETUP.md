# Connect Gmail so the app can read your applications and status from emails

Follow these steps once. After that, you can click **Connect Gmail** and **Sync from Gmail** in the app to pull in job emails and add them to your tracker.

---

## Step 1: Google Cloud project

1. Open **https://console.cloud.google.com** and sign in with the Google account you use for job applications (e.g. allurishreyareddy@gmail.com).
2. Click the project dropdown at the top → **New Project**.
3. Name it (e.g. "Job Tracker") → **Create**. Wait until the project is created, then select it.

---

## Step 2: Turn on Gmail API

1. In the left menu go to **APIs & Services** → **Library** (or "Enable APIs and Services").
2. Search for **Gmail API**.
3. Click **Gmail API** → **Enable**.

---

## Step 3: OAuth consent screen

1. Go to **APIs & Services** → **OAuth consent screen**.
2. Choose **External** (unless you have a Google Workspace org) → **Create**.
3. Fill only the required fields:
   - **App name:** e.g. "Job Application Tracker"
   - **User support email:** your email
   - **Developer contact:** your email
4. Click **Save and Continue**.
5. On **Scopes**, click **Add or Remove Scopes** → search **Gmail API** → enable **.../auth/gmail.readonly** (read only) → **Update** → **Save and Continue**.
6. On **Test users** (if shown), click **Add Users** → add your Gmail address → **Save and Continue**.
7. Finish the flow (e.g. **Back to dashboard**).

---

## Step 4: Create OAuth credentials

1. Go to **APIs & Services** → **Credentials**.
2. Click **+ Create Credentials** → **OAuth client ID**.
3. **Application type:** **Web application**.
4. **Name:** e.g. "Job Tracker Web".
5. Under **Authorized redirect URIs** click **+ Add URI** and add exactly:
   ```text
   http://localhost:3001/api/auth/gmail/callback
   ```
6. Click **Create**.
7. In the popup, copy:
   - **Client ID** (long string ending in `.apps.googleusercontent.com`)
   - **Client secret**

Keep this tab open or paste them into a temporary file; you’ll use them in the next step.

---

## Step 5: Add credentials to your backend

1. Open your project folder and go to the **backend** folder.
2. If there is no **.env** file, create one (e.g. copy from **.env.example**).
3. Open **.env** in an editor and set (use your real Client ID and Client secret from Step 4):

   ```env
   GOOGLE_CLIENT_ID=paste_your_client_id_here.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=paste_your_client_secret_here
   ```

4. Save the file.  
   - Optional: if your frontend runs on a different URL, you can set `FRONTEND_URL=http://localhost:5174` (or whatever port Vite shows).

---

## Step 6: Restart the backend

1. In the terminal where the backend is running, stop it (**Ctrl+C**).
2. Start it again:

   ```bash
   cd backend
   npm start
   ```

   You should see: `Job Tracker API running at http://localhost:3001`.

---

## Step 7: Connect Gmail in the app

1. Open your app in the browser (e.g. http://localhost:5173).
2. Click **Connect Gmail**.
3. You’ll be sent to Google. Sign in with the same Gmail you use for job applications.
4. When Google asks for permission, click **Allow** (read-only access to Gmail).
5. You’ll be sent back to the app. The button will change to **Sync from Gmail** and show “Connected as your@gmail.com”.

---

## Step 8: Sync and add applications from emails

1. Click **Sync from Gmail**.
2. The backend will:
   - Read recent emails from your Gmail inbox
   - Detect job-related emails (application received, interview, offer, rejection, etc.)
   - Guess **company** (from sender), **role** (from subject), and **status** (Applied / Interviewing / Offer / Rejected)
3. A list of **“From your inbox”** suggestions will appear.
4. Click **Add** on each row you want in your tracker, or **Add all** to add every suggestion.
5. You can **Edit** any application after adding to fix company, role, or status.

---

## What the backend does with your emails

- **Reads:** Last ~30 days of inbox (read-only; nothing is deleted or changed in Gmail).
- **Detects:** Emails that look like job-related messages (application received, interview, offer, rejection, etc.).
- **Guesses:** Company (sender name/domain), role (from subject), status from phrases like “we received your application”, “interview”, “offer”, “unfortunately we have decided”, etc.
- **Stores:** Only what you add to the tracker; your Gmail messages stay in Gmail.

---

## If something doesn’t work

- **“Gmail not set up” or redirect back to app right after Connect Gmail**  
  Check that **.env** has correct `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, that the redirect URI in Google Cloud is exactly `http://localhost:3001/api/auth/gmail/callback`, and that you restarted the backend.

- **“Page isn’t working” when clicking Connect Gmail**  
  Make sure the backend is running (`npm start` in `backend/`) and nothing else is using port 3001.

- **Sync finds no applications**  
  The app looks for job-related wording. Try with an inbox that has at least a few “application received” or “interview” emails. You can still add applications manually with **+ Add application**.

Once this is set up, you only need to click **Sync from Gmail** whenever you want to pull in new applications and status from your email.
