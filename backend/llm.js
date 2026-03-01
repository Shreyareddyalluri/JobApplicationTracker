const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2";

/**
 * Low-level call to Ollama chat API
 */
async function ollamaChat(prompt, temperature = 0.1) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: prompt }],
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

/**
 * Step 1: Classify whether an email is job-application related.
 * Fast, tiny prompt — cheap even on local hardware.
 * Returns true if job-related, false if spam/promo/other.
 *
 * @param {string} emailContent
 * @returns {Promise<boolean>}
 */
async function isJobEmail(emailContent) {
  if (!emailContent || emailContent.trim().length === 0) return false;

  const prompt = `You are a classifier. Determine if this email is related to a job application process.

Answer ONLY with "yes" or "no". No explanation, no punctuation, just the single word.

Examples of YES:
- "Thank you for applying to Software Engineer at Acme"
- "We'd like to schedule an interview"
- "Unfortunately we will not be moving forward with your application"
- "Congratulations, we'd like to extend an offer"
- "Your application has been received"

Examples of NO:
- "Triple Cash Back is HERE - shop through Rakuten"
- "Your Amazon order has shipped"
- "50% off sale ends tonight"
- "H-1B FY-2026 Sponsorship" (spam/scam, not from an employer)
- "Unsubscribe from our newsletter"
- "Your receipt from DoorDash"

Email to classify:
---
${emailContent.substring(0, 1000)}
---`;

  try {
    const response = await ollamaChat(prompt, 0.0);
    const answer = response.toLowerCase().trim();
    return answer.startsWith("yes");
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") {
      console.error("Ollama is not running. Start it with: ollama serve");
    } else {
      console.error("LLM classification error:", error.message);
    }
    // On failure, default to true so we don't silently drop emails
    return true;
  }
}

/**
 * Step 2: Summarize a confirmed job email and extract action items.
 * Only called after isJobEmail() returns true.
 *
 * @param {string} emailContent
 * @returns {Promise<{ summary, actionItems, suggestedStatus }>}
 */
async function summarizeEmail(emailContent) {
  if (!emailContent || emailContent.trim().length === 0) {
    return {
      summary: "Empty email",
      actionItems: [],
      suggestedStatus: "Applied",
    };
  }

  const prompt = `You are a job application assistant. Analyze this job-related email and extract:
1. A concise 1-line summary (max 20 words)
2. Up to 3 action items (what the applicant should do next)
3. The application status — choose EXACTLY one of: Applied, Interviewing, Offer, Rejected

Status rules (read carefully):
- Applied: application received/confirmed, "thank you for applying", "we'll be in touch", waiting to hear back
- Interviewing: interview scheduled or invited, phone screen, take-home test, "moving forward"
- Offer: job offer extended, "pleased to offer", "we'd like to offer you the position"
- Rejected: explicitly told NOT moving forward, "decided to pursue other candidates", "position filled"
- If unsure between Applied and Rejected — default to Applied. Only use Rejected if the email explicitly says they are NOT proceeding.

Return ONLY valid JSON, no explanation or markdown:
{
  "summary": "...",
  "actionItems": ["item1", "item2"],
  "suggestedStatus": "Applied"
}

Email content:
---
${emailContent.substring(0, 2000)}
---`;

  try {
    const responseText = await ollamaChat(prompt, 0.1);

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
        suggestedStatus: "Applied",
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: parsed.summary || "Processed by AI",
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      suggestedStatus: [
        "Applied",
        "Interviewing",
        "Offer",
        "Rejected",
      ].includes(parsed.suggestedStatus)
        ? parsed.suggestedStatus
        : "Applied",
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
      suggestedStatus: "Applied",
    };
  }
}

module.exports = { isJobEmail, summarizeEmail };
