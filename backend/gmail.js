const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const TOKEN_PATH = path.join(__dirname, 'data', 'gmail_tokens.json');
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

function isGmailConfigured() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return !!(clientId && clientSecret && clientId.trim() && clientSecret.trim());
}

function getOAuth2Client() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:3001/api/auth/gmail/callback';
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env');
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthUrl(state) {
  const oauth2 = getOAuth2Client();
  const options = {
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
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
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function setStoredTokens(tokens) {
  ensureDataDir();
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
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
  oauth2.on('tokens', (newTokens) => {
    const current = getStoredTokens() || {};
    setStoredTokens({ ...current, ...newTokens });
  });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

async function getConnectedEmail() {
  try {
    const gmailClient = await getAuthenticatedClient();
    if (!gmailClient) return null;
    const res = await gmailClient.users.getProfile({ userId: 'me' });
    return (res.data && res.data.emailAddress) || null;
  } catch {
    return null;
  }
}

function decodeBase64Url(str) {
  if (!str) return '';
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function getBodyFromPayload(payload) {
  let text = '';
  if (payload.body && payload.body.data) {
    text += decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        text += decodeBase64Url(part.body.data);
      }
      if (part.mimeType === 'text/html' && part.body && part.body.data && !text) {
        const html = decodeBase64Url(part.body.data);
        text += html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  return text;
}

function getHeader(payload, name) {
  const header = (payload.headers || []).find(h => (h.name || '').toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

async function listRecentMessages(gmail, maxResults = 100, query = '') {
  const q = query || 'newer_than:90d';
  const res = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q,
    labelIds: ['INBOX'],
  });
  return (res.data.messages || []).map(m => m.id);
}

// Simpler search: just recent inbox (complex Gmail queries can return 0)
const GMAIL_RECENT_QUERY = 'newer_than:90d';

async function getMessage(gmail, id) {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'full',
  });
  return res.data;
}

const JOB_KEYWORDS = [
  'application', 'applied', 'your application', 'we received your application',
  'thank you for your application', 'application confirmation', 'application status',
  'job application successfully submitted', 'update on your application', 'application update',
  'thank you for applying', 'thank you for your interest', 'we\'ll review your application',
  'interview', 'schedule an interview', 'next steps', 'moving forward',
  'offer', 'congratulations', 'position', 'role', 'candidate', 'recruiting',
  'hiring', 'unfortunately', 'not moving forward', 'other candidates', 'job application',
  're: application', 're: your application', 're: ', 'application for', 'job posting',
  'careers@', 'recruiting@', 'talent@', 'staffing', 'workday', 'people team', 'hiring team',
  'we received your resume', 'your resume', 'software engineer', 'developer', 'engineer',
  'moved forward', 'next step', 'schedule a call', 'phone screen', 'technical interview',
  'greenhouse', 'lever.co', 'icims', 'jobvite', 'applicant', 'outcome', 'dear shreya',
];

const STATUS_PHRASES = {
  Applied: [
    'we have received your application', 'application received', 'we received your application',
    'thank you for applying', 'thank you for your application', 'your application has been received',
    'application submitted', 'application confirmation', 'job application successfully submitted',
    'we\'ll review your application', 'we will review your application',
  ],
  Interviewing: [
    'invite you for an interview', 'schedule an interview', 'interview schedule',
    'next steps', 'moving forward with your application', 'would like to interview',
    'interview process', 'set up a call', 'phone screen', 'video interview',
  ],
  Offer: [
    'offer', 'congratulations', 'we are pleased to offer', 'extend an offer',
    'job offer', 'delighted to offer',
  ],
  Rejected: [
    'unfortunately', 'not moving forward', 'other candidates', 'we have decided',
    'thank you for your interest', 'at this time we will not', 'not selected',
    'pursue other candidates', 'position has been filled', 'will not be moving',
    'after careful consideration', 'application outcome',
  ],
};

function inferStatus(subject, body) {
  const text = `${(subject || '').toLowerCase()} ${(body || '').toLowerCase()}`;
  for (const [status, phrases] of Object.entries(STATUS_PHRASES)) {
    for (const p of phrases) {
      if (text.includes(p.toLowerCase())) return status;
    }
  }
  return 'Applied';
}

function extractCompanyFromFrom(fromHeader) {
  if (!fromHeader) return 'Unknown Company';
  const match = fromHeader.match(/^([^<]+)</);
  const namePart = match ? match[1].trim() : fromHeader;
  const emailMatch = fromHeader.match(/@([\w.-]+)/);
  const domain = emailMatch ? emailMatch[1] : '';
  const noReply = namePart.replace(/\s*(noreply|no-reply|donotreply)\s*/gi, '').trim();
  const companyFromName = noReply
    .replace(/\s*(at|@|via)\s+/i, ' ')
    .replace(/\s*<\s*.*$/, '')
    .trim();
  if (companyFromName && companyFromName.length > 2 && companyFromName.length < 80) {
    return companyFromName;
  }
  if (domain) {
    const clean = domain.replace(/^(mail\.|email\.|careers\.|jobs\.|recruit\.)/i, '').split('.')[0];
    if (clean) return clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  return 'Unknown Company';
}

function extractRoleFromSubject(subject) {
  if (!subject) return 'Unknown Role';
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
  if (s.includes('engineer')) return 'Software Engineer';
  if (s.includes('developer')) return 'Developer';
  if (s.includes('intern')) return 'Intern';
  return subject.slice(0, 60) || 'Unknown Role';
}

function parseEmailForApplication(msg, lenient = false, acceptAny = false) {
  const payload = msg.payload || {};
  const subject = getHeader(payload, 'subject');
  const from = getHeader(payload, 'from');
  const dateHeader = getHeader(payload, 'date');
  const snippet = (msg.snippet || '').slice(0, 500);
  const body = getBodyFromPayload(payload) || snippet;
  const text = `${subject} ${body} ${from}`.toLowerCase();
  const subjectLower = (subject || '').toLowerCase();
  const strictMatch =
    JOB_KEYWORDS.some(kw => text.includes(kw.toLowerCase())) ||
    /\b(application|interview|offer|position|role|candidate|recruiting|re:)\b/.test(subjectLower) ||
    /(careers|recruit|talent|jobs|hiring|noreply)@/i.test(from || '');
  const lenientMatch = subjectLower.includes('re:') || strictMatch;
  const isJobRelated = acceptAny || (lenient ? lenientMatch : strictMatch);
  if (!isJobRelated) return null;

  const company = extractCompanyFromFrom(from);
  const role = extractRoleFromSubject(subject);
  const status = inferStatus(subject, body);
  let appliedDate = new Date().toISOString().slice(0, 10);
  try {
    if (dateHeader) appliedDate = new Date(dateHeader).toISOString().slice(0, 10);
  } catch {}

  return {
    company,
    role,
    status,
    appliedDate,
    notes: snippet.slice(0, 200),
    link: '',
    messageId: msg.id,
    threadId: msg.threadId,
  };
}

async function fetchAndParseEmails(maxMessages = 100, options = {}) {
  const debug = options.debug ? { step1_list: 0, step2_strict: 0, step3_fallback_list: 0, step4_fallback_parsed: 0, error: null } : null;
  try {
    const gmail = await getAuthenticatedClient();
    if (!gmail) return { connected: false, applications: [], debug: debug || undefined };

    // Get recent inbox (simple query so we always get messages)
    let messageIds = await listRecentMessages(gmail, maxMessages, GMAIL_RECENT_QUERY);
    if (debug) debug.step1_list = messageIds.length;

    if (messageIds.length === 0) {
      if (debug) debug.error = 'Gmail returned 0 messages (empty inbox or try another label)';
      return { connected: true, applications: [], debug: debug || undefined };
    }

    const seen = new Set();
    let applications = [];

    for (const id of messageIds.slice(0, 80)) {
      try {
        const msg = await getMessage(gmail, id);
        const parsed = parseEmailForApplication(msg, false);
        if (!parsed) continue;
        const key = parsed.threadId || parsed.messageId;
        if (seen.has(key)) continue;
        seen.add(key);
        applications.push(parsed);
      } catch (err) {
        if (debug) debug.error = (debug.error || '') + (err.message || String(err)) + ' ';
      }
    }
    if (debug) debug.step2_strict = applications.length;

    // Fallback: lenient parsing (subject has "re:" or any job keyword)
    if (applications.length === 0) {
      const fallbackIds = messageIds.slice(0, 30);
      if (debug) debug.step3_fallback_list = fallbackIds.length;
      for (const id of fallbackIds) {
        try {
          const msg = await getMessage(gmail, id);
          const parsed = parseEmailForApplication(msg, true);
          if (!parsed) continue;
          const key = parsed.threadId || parsed.messageId;
          if (seen.has(key)) continue;
          seen.add(key);
          applications.push(parsed);
        } catch (err) {
          if (debug) debug.error = (debug.error || '') + (err.message || String(err)) + ' ';
        }
      }
      if (debug) debug.step4_fallback_parsed = applications.length;
    }

    // Last resort: accept any recent email so user sees something (first 15 only)
    if (applications.length === 0 && messageIds.length > 0) {
      for (const id of messageIds.slice(0, 15)) {
        try {
          const msg = await getMessage(gmail, id);
          const parsed = parseEmailForApplication(msg, false, true);
          if (!parsed) continue;
          const key = parsed.threadId || parsed.messageId;
          if (seen.has(key)) continue;
          seen.add(key);
          applications.push(parsed);
        } catch (err) {
          if (debug) debug.error = (debug.error || '') + (err.message || String(err)) + ' ';
        }
      }
    }

    return { connected: true, applications, debug: debug || undefined };
  } catch (err) {
    if (debug) debug.error = err.message || String(err);
    return { connected: false, applications: [], debug: debug || undefined };
  }
}

module.exports = {
  isGmailConfigured,
  getAuthUrl,
  saveTokensFromCode,
  getStoredTokens,
  getAuthenticatedClient,
  getConnectedEmail,
  fetchAndParseEmails,
};
