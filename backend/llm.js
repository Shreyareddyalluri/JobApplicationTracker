const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

/**
 * Low-level call to Ollama chat API.
 * Uses a system message to set the role and a user message for the task.
 */
async function ollamaChat(systemPrompt, userPrompt, temperature = 0.1) {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: userPrompt });

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      options: { temperature },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.message?.content || "";
}

// ---------------------------------------------------------------------------
// Step 1: Heuristic-based email classifier (NO LLM call).
//
// Why heuristics instead of LLM:
//   llama3.2 (3B params) is unreliable for binary yes/no classification —
//   it rejected 84% of legitimate application emails across multiple prompt
//   iterations. Heuristics are fast, deterministic, and testable.
//
// Strategy: By the time an email reaches isJobEmail(), it has already passed
// the keyword filter AND the bulk sender/subject filters in gmail.js. So we
// only need to reject obvious non-job spam that slipped through keywords.
// Everything else should be passed to the summarizer.
// ---------------------------------------------------------------------------

/** Patterns that indicate this is NOT a job application email */
const SPAM_PATTERNS = [
  // Shopping / promotions
  /cash back/i,
  /\bcoupon\b/i,
  /\bsale\b.*\boff\b/i,
  /\bsale ends\b/i,
  /\bdiscount\b/i,
  /\bfree shipping\b/i,
  /doordash|ubereats|grubhub|instacart/i,
  /your (order|receipt|purchase|delivery)/i,
  // Security / OTP (not job portal specific)
  /one-time password/i,
  /\botp\b/i,
  /verify your (identity|email|account)/i,
  /confirm your (identity|email|account)/i,
  /account (creation|verification)/i,
  // Generic spam
  /protect yourself from fake/i,
  /\bunsubscribe\b.*\bnewsletter\b/i,
];

/** Patterns that STRONGLY indicate this IS a job application email */
const JOB_PATTERNS = [
  /\bapplication\b/i,
  /\bapplied\b/i,
  /\bapplying\b/i,
  /thank you for (your interest|applying|your application)/i,
  /we (received|have received) your (application|resume)/i,
  /\binterview\b/i,
  /\boffer\b.*\b(position|role|letter)\b/i,
  /not (be )?(moving|going) forward/i,
  /won't be moving forward/i,
  /decided (not )?to (move|proceed|pursue)/i,
  /regret to inform/i,
  /position.*closed/i,
  /application (received|update|status|confirmation)/i,
  /follow[- ]?up on your application/i,
  /\brecruiting\b/i,
  /\brecruiter\b/i,
  /careers@|recruiting@|talent@|do-not-reply@.*paylocity/i,
];

/**
 * Fast, deterministic email classifier using regex heuristics.
 * No LLM call — returns instantly.
 *
 * @param {string} emailContent — Subject + From + Body concatenated
 * @returns {Promise<boolean>} — true if likely a job application email
 */
async function isJobEmail(emailContent) {
  if (!emailContent || emailContent.trim().length === 0) return false;

  const text = emailContent.substring(0, 2000);

  // If it matches a strong job pattern, always accept
  if (JOB_PATTERNS.some((re) => re.test(text))) return true;

  // If it matches a spam pattern and NOT a job pattern, reject
  if (SPAM_PATTERNS.some((re) => re.test(text))) {
    console.log(`[Heuristic] Rejected as spam: ${text.substring(0, 80)}`);
    return false;
  }

  // Default: accept (the keyword filter in gmail.js already pre-filtered)
  return true;
}

// ---------------------------------------------------------------------------
// Step 2: Summarize a confirmed job email and extract structured data.
//
// The LLM is ONLY used here, for structured extraction — not classification.
// Prompt is kept concise for llama3.2 compatibility.
// ---------------------------------------------------------------------------

const SUMMARIZE_SYSTEM = `You extract job application info from emails. Return ONLY valid JSON.

Decide the status using these rules IN ORDER:

1. REJECTED if email says: "not moving forward", "won't be moving forward", "regret to inform", "not selected", "decided to pursue other candidates", "position filled", "move forward with another candidate", "has not been selected"
2. OFFER if email says: "pleased to offer", "extend an offer", "offer letter", "congratulations on your offer"
3. INTERVIEWING if email says: "interview scheduled", "phone screen", "video call", "1:1 with", "technical interview", "come prepared", "coding challenge", "take-home"
4. OA if email says: "online assessment", "HackerRank", "CodeSignal", "complete this assessment"
5. APPLIED if none of the above match

Return this exact JSON format:
{"reasoning":"why you chose this status","summary":"1-line summary max 15 words","actionItems":["action1"],"suggestedStatus":"Applied"}`;

/**
 * Summarize a confirmed job email and extract status, summary, action items.
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

  // --- Pre-check: use regex to detect status before LLM as a fallback ---
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

  const userPrompt = `Extract info from this job email. Return ONLY JSON.

${emailContent.substring(0, 2500)}`;

  try {
    const responseText = await ollamaChat(SUMMARIZE_SYSTEM, userPrompt, 0.1);

    // Strip markdown fences if model wraps output
    const cleaned = responseText.replace(/```json|```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn(
        "Could not extract JSON from Ollama response:",
        responseText.slice(0, 200),
      );
      return {
        summary: emailContent.substring(0, 100) + "...",
        actionItems: [],
        // Use regex fallback when LLM fails to produce JSON
        suggestedStatus: regexStatus || "Applied",
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Log the reasoning for debugging
    if (parsed.reasoning) {
      console.log(`[LLM] Reasoning: ${parsed.reasoning}`);
    }

    const validStatuses = ["Applied", "Interviewing", "OA", "Offer", "Rejected"];
    let finalStatus = validStatuses.includes(parsed.suggestedStatus)
      ? parsed.suggestedStatus
      : "Applied";

    // Regex status override: if regex found a strong signal (especially Rejected)
    // but LLM disagreed, trust the regex — it's based on exact phrase matching.
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
    if (error.cause?.code === "ECONNREFUSED") {
      console.error("Ollama is not running. Start it with: ollama serve");
    } else {
      console.error("LLM summarization error:", error.message);
    }
    return {
      summary: emailContent.substring(0, 100) + "...",
      actionItems: ["Review email manually"],
      // Use regex fallback on LLM error too
      suggestedStatus: regexStatus || "Applied",
    };
  }
}

module.exports = { isJobEmail, summarizeEmail };
