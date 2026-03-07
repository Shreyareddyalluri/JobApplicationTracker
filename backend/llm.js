const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

/**
 * Low-level call to Ollama chat API.
 * Uses a system message to set the role and a user message for the task.
 */
async function ollamaChat(systemPrompt, userPrompt, temperature = 0.1, jsonFormat = false) {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });

  const bodyOptions = {
    model: OLLAMA_MODEL,
    messages,
    stream: false,
    options: { temperature },
  };

  // Enforce JSON structured output if requested
  if (jsonFormat) {
    bodyOptions.format = "json";
  }

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyOptions),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.message?.content || "";
}

// ---------------------------------------------------------------------------
// Step 1: Hybrid Email Classifier (Heuristic pre-filter + Few-Shot LLM)
//
// Strategy: 
// 1. Instantly reject obvious promo/spam using SPAM_PATTERNS to save compute.
// 2. Instantly accept obvious job matches using JOB_PATTERNS.
// 3. (NEW) For everything else, use a strict structured JSON LLM prompt with
//    Few-Shot examples so the 3B model understands the nuanced boundaries.
// ---------------------------------------------------------------------------

/** Patterns that indicate this is NOT a job application email */
const SPAM_PATTERNS = [
  /cash back/i,
  /\bcoupon\b/i,
  /\bsale\b.*\boff\b/i,
  /\bsale ends\b/i,
  /doordash|ubereats|grubhub/i,
  /your (order|receipt|purchase|delivery)/i,
  /one-time password/i,
  /\botp\b/i,
  /verify your (identity|email)/i,
  /\bunsubscribe\b.*\bnewsletter\b/i,
];

/** Patterns that STRONGLY indicate this IS a job application email */
const JOB_PATTERNS = [
  /thank you for (your interest|applying|your application)/i,
  /we (received|have received) your (application|resume)/i,
  /\boffer\b.*\b(position|role|letter)\b/i,
  /not (be )?(moving|going) forward/i,
  /won't be moving forward/i,
  /decided (not )?to (move|proceed|pursue)/i,
  /regret to inform/i,
];

const CLASSIFY_SYSTEM_JSON = `You are an expert email classifier. Evaluate if the email is a direct, personal communication from an employer about a specific job application.
You MUST output ONLY a valid JSON object matching this exact schema:
{
  "is_job_email": boolean,
  "reasoning": "string (1-sentence max)"
}

### EXAMPLES

Input: "Subject: ⭐⭐⭐Triple Cash Back is HERE ⭐⭐⭐ From: deals@rakuten.com Body: Shop now!"
Output: {"is_job_email": false, "reasoning": "This is a shopping promotion, not a job application email."}

Input: "Subject: Your 1:1 with Intuit Recruiting Form: recruiting@intuit.com Body: Your 30-minute video call is scheduled."
Output: {"is_job_email": true, "reasoning": "This is an interview scheduling email from a recruiter."}

Input: "Subject: Update on your application From: hr@stripe.com Body: Unfortunately we won't be moving forward."
Output: {"is_job_email": true, "reasoning": "This is a rejection notice for a specific job application."}

### RULES
- YES: Applications, interviews, offers, rejections, recruiter follow-ups.
- NO: Promotional deals, food delivery, OTPs, password resets.
- When in doubt, prefer true. Return ONLY JSON.`;

/**
 * Hybrid email classifier: uses heuristics first, then a Few-Shot JSON LLM call.
 *
 * @param {string} emailContent — Subject + From + Body concatenated
 * @returns {Promise<boolean>} — true if likely a job application email
 */
async function isJobEmail(emailContent) {
  if (!emailContent || emailContent.trim().length === 0) return false;
  const text = emailContent.substring(0, 1500).toLowerCase();

  // 1. Heuristic Pre-filters (save LLM compute)
  if (JOB_PATTERNS.some((re) => re.test(text))) {
    console.log(`[Heuristic] Fast accept: matched strong job pattern`);
    return true;
  }
  if (SPAM_PATTERNS.some((re) => re.test(text))) {
    console.log(`[Heuristic] Fast reject as spam`);
    return false;
  }

  // 2. Fallback to Few-Shot JSON LLM Classification
  const userPrompt = `Evaluate this email:\n\n${emailContent.substring(0, 1200)}`;

  try {
    // Request STRICT JSON format execution
    const responseText = await ollamaChat(CLASSIFY_SYSTEM_JSON, userPrompt, 0.0, true);
    
    // Parse the JSON output
    const cleaned = responseText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    
    if (parsed.reasoning) {
      console.log(`[LLM Classifier] ${parsed.is_job_email ? 'YES' : 'NO'} | ${parsed.reasoning}`);
    }
    
    return parsed.is_job_email === true;
  } catch (error) {
    console.error("LLM classification error (falling back to true):", error.message);
    // On LLM JSON parse failure, default to true so we don't drop emails
    return true;
  }
}

// ---------------------------------------------------------------------------
// Step 2: Summarize a confirmed job email and extract structured data.
//
const SUMMARIZE_SYSTEM_JSON = `You are a job application assistant. Your job is to summarize an email and determine the application status.
You MUST output ONLY a valid JSON object matching this exact schema:
{
  "reasoning": "string (1-sentence explanation)",
  "summary": "string (1-line summary max 15 words)",
  "actionItems": ["string"],
  "suggestedStatus": "Applied | Interviewing | OA | Offer | Rejected"
}

### EXAMPLES

Input: "Subject: Update on your application Body: Unfortunately we won't be moving forward with your candidacy."
Output: {"reasoning":"The email states they will not move forward, indicating a rejection.","summary":"Rejected for the position","actionItems":[],"suggestedStatus":"Rejected"}

Input: "Subject: Your 1:1 with Recruiting Body: Your 30-minute video call is scheduled."
Output: {"reasoning":"The email confirms a scheduled video call with a recruiter.","summary":"Video interview scheduled","actionItems":["Prepare for video call"],"suggestedStatus":"Interviewing"}

Input: "Subject: Complete your Online Assessment Body: Please complete the HackerRank challenge within 48 hours."
Output: {"reasoning":"The email contains a link to a HackerRank online assessment.","summary":"HackerRank assessment received","actionItems":["Complete assessment within 48h"],"suggestedStatus":"OA"}

### RULES FOR STATUS
1. REJECTED: "won't be moving forward", "regret to inform", "move forward with another candidate"
2. OFFER: "pleased to offer", "extend an offer", "offer letter"
3. INTERVIEWING: "interview scheduled", "phone screen", "video call", "technical interview", "coding challenge", "take-home"
4. OA: "online assessment", "HackerRank", "CodeSignal"
5. APPLIED: If none of the above match, or it's just a confirmation.
Return ONLY JSON.`;

/**
 * Summarize a confirmed job email and extract status, summary, action items.
 * Uses Few-Shot JSON LLM prompting, with regex fallbacks for safety.
 *
 * @param {string} emailContent
 * @returns {Promise<{ summary: string, actionItems: string[], suggestedStatus: string }>}
 */
async function summarizeEmail(emailContent) {
  if (!emailContent || emailContent.trim().length === 0) {
    return {
      summary: "Empty email",
      actionItems: [],
      suggestedStatus: "Applied",
    };
  }

  // --- 1. Heuristic Pre-calculation (Safety Net) ---
  const text = emailContent.toLowerCase();
  let regexStatus = null;
  if (
    /not (be )?(moving|going) forward/i.test(text) ||
    /won't be moving forward/i.test(text) ||
    /regret to inform/i.test(text) ||
    /has not been selected/i.test(text) ||
    /not selected for/i.test(text) ||
    /decided to (move forward with another|pursue other)/i.test(text) ||
    /position (has been |was )?filled/i.test(text) ||
    /will not be moving forward/i.test(text) ||
    /decided not to (move forward|proceed)/i.test(text) ||
    /unfortunately.{0,40}(not|won't|will not).{0,40}(forward|proceed|candidacy)/i.test(text) ||
    /we have determined not to move forward/i.test(text)
  ) {
    regexStatus = "Rejected";
  } else if (
    /pleased to offer|extend an offer|offer letter|congratulations on your offer/i.test(text)
  ) {
    regexStatus = "Offer";
  } else if (
    /interview (scheduled|has been scheduled)|schedule an interview|1:1 with|phone screen|video call.*recruiter|technical interview|come prepared to share|coding challenge/i.test(text)
  ) {
    regexStatus = "Interviewing";
  } else if (
    /online assessment|hackerrank|codesignal|codility|complete this assessment/i.test(text)
  ) {
    regexStatus = "OA";
  }

  // --- 2. Few-Shot JSON LLM Evaluation ---
  const userPrompt = `Extract info from this job email:\n\n${emailContent.substring(0, 2500)}`;

  try {
    // Request STRICT JSON format execution
    const responseText = await ollamaChat(SUMMARIZE_SYSTEM_JSON, userPrompt, 0.1, true);

    const cleaned = responseText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.reasoning) {
      console.log(`[LLM Summarizer] Status: ${parsed.suggestedStatus} | ${parsed.reasoning}`);
    }

    const validStatuses = ["Applied", "Interviewing", "OA", "Offer", "Rejected"];
    let finalStatus = validStatuses.includes(parsed.suggestedStatus)
      ? parsed.suggestedStatus
      : "Applied";

    // 3. Fallback / Override Logic
    // If regex found a strong signal (especially Rejected) but LLM disagreed,
    // trust the regex — the 3B model sometimes misses nuanced rejections.
    if (regexStatus && regexStatus !== finalStatus) {
      console.log(
        `[Status Override] Regex says "${regexStatus}", LLM says "${finalStatus}" → using regex`,
      );
      finalStatus = regexStatus;
    }

    return {
      summary: parsed.summary || "Processed by AI",
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      suggestedStatus: finalStatus,
    };
  } catch (error) {
    console.error("LLM summarization error:", error.message);
    return {
      summary: emailContent.substring(0, 100) + "...",
      actionItems: ["Review email manually"],
      // Use regex fallback on LLM error
      suggestedStatus: regexStatus || "Applied",
    };
  }
}

module.exports = { isJobEmail, summarizeEmail };
