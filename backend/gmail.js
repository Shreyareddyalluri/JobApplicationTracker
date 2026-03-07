const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
const { isJobEmail, summarizeEmail } = require("./llm");

const TOKEN_PATH = path.join(__dirname, "data", "gmail_tokens.json");
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

function isGmailConfigured() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return !!(clientId && clientSecret && clientId.trim() && clientSecret.trim());
}

function getOAuth2Client() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const redirectUri =
    process.env.GMAIL_REDIRECT_URI ||
    "http://localhost:3001/api/auth/gmail/callback";
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthUrl(state) {
  const oauth2 = getOAuth2Client();
  const options = {
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  };
  if (state) options.state = state;
  return oauth2.generateAuthUrl(options);
}

function ensureDataDir() {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getStoredTokens() {
  ensureDataDir();
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  } catch {
    return null;
  }
}

function setStoredTokens(tokens) {
  ensureDataDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf8");
}

async function saveTokensFromCode(code) {
  const oauth2 = getOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  setStoredTokens(tokens);
  return tokens;
}

async function getAuthenticatedClient() {
  const tokens = getStoredTokens();
  if (!tokens) return null;
  if (!isGmailConfigured()) return null;
  const oauth2 = getOAuth2Client();
  oauth2.setCredentials(tokens);
  oauth2.on("tokens", (newTokens) => {
    const current = getStoredTokens() || {};
    setStoredTokens({ ...current, ...newTokens });
  });
  return google.gmail({ version: "v1", auth: oauth2 });
}

async function getConnectedEmail() {
  try {
    const gmailClient = await getAuthenticatedClient();
    if (!gmailClient) return null;
    const res = await gmailClient.users.getProfile({ userId: "me" });
    return (res.data && res.data.emailAddress) || null;
  } catch {
    return null;
  }
}

function decodeBase64Url(str) {
  if (!str) return "";
  try {
    const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function getBodyFromPayload(payload) {
  let text = "";
  if (payload.body && payload.body.data) {
    text += decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body && part.body.data) {
        text += decodeBase64Url(part.body.data);
      }
      if (
        part.mimeType === "text/html" &&
        part.body &&
        part.body.data &&
        !text
      ) {
        const html = decodeBase64Url(part.body.data);
        text += html
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }
  return text;
}

function getHeader(payload, name) {
  const header = (payload.headers || []).find(
    (h) => (h.name || "").toLowerCase() === name.toLowerCase(),
  );
  return header ? header.value : "";
}

async function listRecentMessages(gmail, maxResults = 100, query = "") {
  const q = query || "newer_than:90d";
  const res = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q,
    labelIds: ["INBOX"],
  });
  return (res.data.messages || []).map((m) => m.id);
}

// Simpler search: just recent inbox (complex Gmail queries can return 0)
const GMAIL_RECENT_QUERY = "newer_than:90d";

async function getMessage(gmail, id) {
  const res = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });
  return res.data;
}

const JOB_KEYWORDS = [
  // Application confirmations
  "your application",
  "we received your application",
  "thank you for your application",
  "application confirmation",
  "application status",
  "job application successfully submitted",
  "update on your application",
  "application update",
  "thank you for applying",
  "thank you for your interest",
  "we'll review your application",
  "application for",
  "job application",
  "re: your application",
  "re: application",
  // Interview signals
  "interview",
  "schedule an interview",
  "phone screen",
  "technical interview",
  "1:1 with",
  "on-site",
  // Decision signals
  "moving forward",
  "not moving forward",
  "moved forward",
  "other candidates",
  "unfortunately",
  "next steps",
  "next step",
  "offer",
  "congratulations",
  // Employer sender signals
  "careers@",
  "recruiting@",
  "talent@",
  "hiring team",
  "people team",
  "recruiting team",
  // ATS platforms (high confidence)
  "greenhouse",
  "lever.co",
  "icims",
  "jobvite",
  "workday",
  // Personalized
  "dear shreya",
  "hi shreya",
  "applicant",
  "candidacy",
  "candidate",
];

// ---------------------------------------------------------------------------
// Bulk / notification email rejection — applied BEFORE the LLM classifier
// to save tokens and eliminate obvious false positives.
// ---------------------------------------------------------------------------

const BULK_SENDER_PATTERNS = [
  /noreply\.jobs2web\.com/i,
  /jobnotification@/i,
  /jobalert@/i,
  /job-alerts@/i,
  /jobs-noreply@/i,
  /noreply@linkedin\.com/i,
  /messages-noreply@linkedin\.com/i,
  /member@linkedin\.com/i,
  /notifications-noreply@linkedin\.com/i,
  /@indeedmail\.com/i,
  /@indeed\.com/i,
  /@glassdoor\.com/i,
  /@ziprecruiter\.com/i,
  /@dice\.com/i,
  /@simplyhired\.com/i,
  /@monster\.com/i,
  /@careerbuilder\.com/i,
  /@hiringagents\.ai/i,
  /@otta\.com/i,
  /@wellfound\.com/i,
  /@huntr\.co/i,
  /@hired\.com/i,
  /@teal\.com/i,
];

const BULK_SUBJECT_PATTERNS = [
  /new jobs? (?:for you|found|matching|based on)/i,
  /jobs? (?:matching|related to) your/i,
  /your job (?:alert|agent|search|match)/i,
  /job recommendations?/i,
  /weekly (?:job|career) (?:digest|update|roundup|summary)/i,
  /daily (?:job|career) (?:digest|update|roundup|summary)/i,
  /(?:top|new|trending) (?:jobs?|opportunities)/i,
  /jobs? you might (?:like|be interested in)/i,
  /(?:career|job) (?:newsletter|tips|advice)/i,
  /your (?:weekly|daily|monthly) job/i,
  /matched the following jobs/i,
  /careers? you may be interested in/i,
];

const BULK_BODY_PATTERNS = [
  /you are receiving this email because you joined.*talent community/i,
  /your job agent.*matched the following/i,
  /click to modify/i,
  /unsubscribe.*job alert/i,
  /add another job agent/i,
  /change the job agent frequency/i,
  /i'm .+, your career agent at/i,
  /i took a look at your background/i,
  /here are.*roles that (?:look|seem) aligned/i,
  /strengthen your profile.*by referring/i,
  /forward these jobs to.*friends/i,
];

/**
 * Returns true if the email is a bulk job-board notification / AI career
 * agent outreach rather than a direct employer communication.
 */
function isBulkJobNotification(from, subject, body) {
  const fromStr = (from || "").toLowerCase();
  const subjectStr = (subject || "").toLowerCase();
  const bodyStr = (body || "").toLowerCase();

  // Check sender
  if (BULK_SENDER_PATTERNS.some((re) => re.test(fromStr))) {
    // Some senders (e.g. LinkedIn) can send BOTH digests and legit confirmations.
    // If subject looks like an actual application update, let it through.
    const appConfirmation =
      /your application|application (received|confirmed|status|update)/i.test(
        subjectStr,
      );
    if (!appConfirmation) {
      console.log(`[Bulk Filter] Rejected sender: ${fromStr.slice(0, 80)}`);
      return true;
    }
  }

  // Check subject
  if (BULK_SUBJECT_PATTERNS.some((re) => re.test(subjectStr))) {
    console.log(`[Bulk Filter] Rejected subject: ${subjectStr.slice(0, 80)}`);
    return true;
  }

  // Check body for strong bulk indicators (need ≥ 2 matches to reduce false positives)
  const bodyMatches = BULK_BODY_PATTERNS.filter((re) => re.test(bodyStr)).length;
  if (bodyMatches >= 2) {
    console.log(
      `[Bulk Filter] Rejected body (${bodyMatches} bulk signals): ${subjectStr.slice(0, 80)}`,
    );
    return true;
  }

  return false;
}

// Keyword status inference — conservative fallback only.
// Only match phrases that are unambiguous without full context.
// The LLM overrides this with a more accurate reading of the full email body.
const STATUS_PHRASES = {
  // Check Rejected FIRST — prevents "decided to move forward with another
  // candidate" from accidentally matching the "moving forward" Interviewing phrase.
  Rejected: [
    "we will not be moving forward with your application",
    "will not be moving forward with your candidacy",
    "decided not to move forward with your application",
    "decided to move forward with another candidate",
    "decided to pursue other candidates",
    "not selected for this position",
    "position has been filled",
    "we have decided to pursue other candidates",
    "decided not to proceed with your application",
    "not moving forward",
    "we regret to inform",
    "unfortunately, we have decided",
    "unfortunately we have made the difficult decision",
    "concluded interviews and have decided to move forward with another",
  ],
  Offer: [
    "we are pleased to offer",
    "extend an offer",
    "delighted to offer",
    "pleased to extend an offer",
    "we'd like to offer you",
    "congratulations on your offer",
    "offer letter",
    "compensation package",
  ],
  Interviewing: [
    "invite you for an interview",
    "schedule an interview",
    "interview scheduled",
    "interview has been scheduled",
    "1:1 with our recruiter",
    "1:1 with",
    "would like to interview you",
    "phone screen",
    "video interview",
    "video call",
    "technical interview",
    "on-site interview",
    "meet with our team",
    "next round of interviews",
    "moving forward with your application to the interview",
    "come prepared to share",
    "coding challenge",
    "take-home",
    "schedule a call",
  ],
  Applied: [
    "we have received your application",
    "we received your application",
    "your application has been received",
    "application submitted",
    "job application successfully submitted",
    "thank you for applying",
    "thank you for your interest",
  ],
};
// Priority order is determined by the object key order above:
// Rejected → Offer → Interviewing → Applied
function inferStatus(subject, body) {
  const text = `${(subject || "").toLowerCase()} ${(body || "").toLowerCase()}`;
  for (const [status, phrases] of Object.entries(STATUS_PHRASES)) {
    for (const p of phrases) {
      if (text.includes(p.toLowerCase())) return status;
    }
  }
  return "Applied";
}

function extractCompanyFromFrom(fromHeader) {
  if (!fromHeader) return "Unknown Company";
  const match = fromHeader.match(/^([^<]+)</);
  const namePart = match ? match[1].trim() : fromHeader;
  const emailMatch = fromHeader.match(/@([\w.-]+)/);
  const domain = emailMatch ? emailMatch[1] : "";
  const noReply = namePart
    .replace(/\s*(noreply|no-reply|donotreply)\s*/gi, "")
    .trim();
  const companyFromName = noReply
    .replace(/\s*(at|@|via)\s+/i, " ")
    .replace(/\s*<\s*.*$/, "")
    .trim();
  if (
    companyFromName &&
    companyFromName.length > 2 &&
    companyFromName.length < 80
  ) {
    return companyFromName;
  }
  if (domain) {
    const clean = domain
      .replace(/^(mail\.|email\.|careers\.|jobs\.|recruit\.)/i, "")
      .split(".")[0];
    if (clean) return clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  return "Unknown Company";
}

function extractRoleFromSubject(subject) {
  if (!subject) return "Unknown Role";
  const s = subject.toLowerCase();
  const patterns = [
    /(?:re:\s*)?(?:application\s+for\s+)?([^\-–—]+?)(?:\s*[-–—]|$)/i,
    /(?:position|role)\s*[:\s]+([^\-–—,]+)/i,
    /([a-z]+(?:\s+[a-z]+)?)\s+(?:engineer|developer|analyst|designer|manager)/i,
  ];
  for (const p of patterns) {
    const m = subject.match(p);
    if (m && m[1]) {
      const role = m[1].trim();
      if (role.length > 2 && role.length < 100) return role;
    }
  }
  if (s.includes("engineer")) return "Software Engineer";
  if (s.includes("developer")) return "Developer";
  if (s.includes("intern")) return "Intern";
  return subject.slice(0, 60) || "Unknown Role";
}

function parseEmailForApplication(msg, lenient = false, acceptAny = false) {
  const payload = msg.payload || {};
  const subject = getHeader(payload, "subject");
  const from = getHeader(payload, "from");
  const dateHeader = getHeader(payload, "date");
  const snippet = (msg.snippet || "").slice(0, 500);
  const body = getBodyFromPayload(payload) || snippet;
  const text = `${subject} ${body} ${from}`.toLowerCase();
  const subjectLower = (subject || "").toLowerCase();

  // --- Bulk / notification filter (before keyword matching) ---
  if (isBulkJobNotification(from, subject, body)) {
    return {
      filtered: true,
      reason: "Bulk/notification email",
      subject: subject || "(no subject)",
      company: extractCompanyFromFrom(from),
      from: from || "",
      messageId: msg.id,
      threadId: msg.threadId,
    };
  }

  const strictMatch =
    JOB_KEYWORDS.some((kw) => text.includes(kw.toLowerCase())) ||
    /\b(application|interview|offer|candidate|recruiting)\b/.test(
      subjectLower,
    ) ||
    /(careers|recruit|talent|hiring)@/i.test(from || "");
  const lenientMatch = subjectLower.includes("re:") || strictMatch;
  const isJobRelated = acceptAny || (lenient ? lenientMatch : strictMatch);
  if (!isJobRelated) return null;

  const company = extractCompanyFromFrom(from);
  const role = extractRoleFromSubject(subject);
  const status = inferStatus(subject, body);
  let appliedDate = new Date().toISOString().slice(0, 10);
  try {
    if (dateHeader)
      appliedDate = new Date(dateHeader).toISOString().slice(0, 10);
  } catch {}

  return {
    subject: subject || "Job Application",
    company,
    role,
    status,
    appliedDate,
    notes: snippet.slice(0, 200),
    link: "",
    messageId: msg.id,
    threadId: msg.threadId,
  };
}

async function fetchAndParseEmails(maxMessages = 100, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const debug = options.debug
    ? {
        step1_list: 0,
        step2_keyword: 0,
        step3_ai_classified: 0,
        error: null,
      }
    : null;

  // Collect emails filtered out at any stage
  const filteredOut = [];

  try {
    const gmail = await getAuthenticatedClient();
    if (!gmail)
      return { connected: false, applications: [], filteredOut: [], debug: debug || undefined };

    // Step 1: list recent inbox messages
    onProgress("status", { message: "📋 Listing inbox messages…" });
    const messageIds = await listRecentMessages(
      gmail,
      maxMessages,
      GMAIL_RECENT_QUERY,
    );
    if (debug) debug.step1_list = messageIds.length;

    if (messageIds.length === 0) {
      if (debug) debug.error = "Gmail returned 0 messages";
      return { connected: true, applications: [], filteredOut: [], debug: debug || undefined };
    }

    onProgress("status", {
      message: `📥 Reading ${Math.min(messageIds.length, 80)} emails…`,
    });

    // Step 2: fetch full messages and run keyword + bulk filter
    const seen = new Set();
    const candidates = [];

    for (const id of messageIds.slice(0, 80)) {
      try {
        const msg = await getMessage(gmail, id);
        const parsed = parseEmailForApplication(msg, false);
        if (!parsed) continue;

        // If it was bulk-filtered, collect it and skip
        if (parsed.filtered) {
          const key = parsed.threadId || parsed.messageId;
          if (!seen.has(key)) {
            seen.add(key);
            filteredOut.push(parsed);
          }
          continue;
        }

        const key = parsed.threadId || parsed.messageId;
        if (seen.has(key)) continue;
        seen.add(key);

        const payload = msg.payload || {};
        const fullBody = getBodyFromPayload(payload) || msg.snippet || "";
        const emailContent = [
          `Subject: ${parsed.subject || ""}`,
          `From: ${getHeader(payload, "from") || ""}`,
          `Body: ${fullBody.substring(0, 1500)}`,
        ].join("\n");

        candidates.push({ parsed, emailContent });
      } catch (err) {
        if (debug)
          debug.error =
            (debug.error || "") + (err.message || String(err)) + " ";
      }
    }
    if (debug) debug.step2_keyword = candidates.length;

    onProgress("status", {
      message: `🔍 Keyword-matched ${candidates.length} emails — classifying with AI…`,
    });

    // Step 3: AI classification in parallel with per-item progress
    let classifiedCount = 0;
    const classified = await Promise.all(
      candidates.map(async ({ parsed, emailContent }) => {
        try {
          const jobRelated = await isJobEmail(emailContent);
          classifiedCount++;
          onProgress("status", {
            message: `🔍 Classifying… ${classifiedCount}/${candidates.length}`,
          });
          if (!jobRelated) {
            console.log(`[LLM] Rejected: "${parsed.subject}"`);
            // Track LLM-rejected emails too
            filteredOut.push({
              filtered: true,
              reason: "AI classified as not job-related",
              subject: parsed.subject,
              company: parsed.company,
              from: "",
              messageId: parsed.messageId,
              threadId: parsed.threadId,
            });
            return null;
          }
          return { ...parsed, _emailContent: emailContent };
        } catch (err) {
          console.warn(
            `[LLM] Classifier error for "${parsed.subject}": ${err.message}`,
          );
          return { ...parsed, _emailContent: emailContent };
        }
      }),
    );

    const applications = classified.filter(Boolean);
    if (debug) debug.step3_ai_classified = applications.length;
    console.log(
      `[Gmail] ${candidates.length} keyword-matched → ${applications.length} after AI classification, ${filteredOut.length} filtered out`,
    );

    return { connected: true, applications, filteredOut, debug: debug || undefined };
  } catch (err) {
    if (debug) debug.error = err.message || String(err);
    return { connected: false, applications: [], filteredOut: [], debug: debug || undefined };
  }
}

/**
 * Summarize each classified job email.
 * Classification already happened in fetchAndParseEmails with the real body.
 * Each app carries _emailContent set during classification — reuse it here.
 * Runs in parallel for speed.
 */
async function enhanceApplicationsWithAI(applications, onProgress) {
  const notify = onProgress || (() => {});
  let done = 0;
  const total = applications.length;

  const results = await Promise.all(
    applications.map(async (app) => {
      const emailContent =
        app._emailContent ||
        [
          `Subject: ${app.subject || ""}`,
          `From: ${app.company}`,
          `Body: ${app.notes || ""}`,
        ].join("\n");

      try {
        const aiData = await summarizeEmail(emailContent);
        done++;
        notify(done, total);
        const { _emailContent, ...cleanApp } = app;
        return {
          ...cleanApp,
          // LLM status overrides keyword-inferred status — it has full email context
          status: aiData.suggestedStatus,
          aiSummary: aiData.summary,
          aiActionItems: aiData.actionItems,
          aiProcessed: true,
        };
      } catch (err) {
        done++;
        notify(done, total);
        console.error(
          `[LLM] Summarization error for "${app.subject}":`,
          err.message,
        );
        const { _emailContent, ...cleanApp } = app;
        return {
          ...cleanApp,
          aiSummary: null,
          aiActionItems: [],
          aiStatus: app.status,
          aiProcessed: false,
        };
      }
    }),
  );

  return results;
}

module.exports = {
  isGmailConfigured,
  getAuthUrl,
  saveTokensFromCode,
  getStoredTokens,
  getAuthenticatedClient,
  getConnectedEmail,
  fetchAndParseEmails,
  enhanceApplicationsWithAI,
};
