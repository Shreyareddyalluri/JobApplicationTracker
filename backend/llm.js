const Groq = require('groq-sdk');

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/**
 * Summarize an email and extract action items using Groq
 * @param {string} emailContent - Full email text
 * @returns {Promise<Object>} - { summary, actionItems: [], suggestedStatus }
 */
async function summarizeEmail(emailContent) {
  if (!emailContent || emailContent.trim().length === 0) {
    return {
      summary: 'Empty email',
      actionItems: [],
      suggestedStatus: 'Applied',
    };
  }

  const prompt = `You are a job application assistant. Analyze this job-related email and extract:
1. A concise 1-line summary (max 20 words)
2. Up to 3 action items (what the user should do based on this email)
3. The application status: one of [Applied, Interviewing, Offer, Rejected]

Return JSON with this structure:
{
  "summary": "...",
  "actionItems": ["item1", "item2", ...],
  "suggestedStatus": "Applied|Interviewing|Offer|Rejected"
}

Email content:
---
${emailContent.substring(0, 2000)}
---`;

  try {
    const message = await groq.messages.create({
      model: 'mixtral-8x7b-32768',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = message.content[0].text;
    
    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('Could not extract JSON from LLM response');
      return {
        summary: emailContent.substring(0, 100) + '...',
        actionItems: [],
        suggestedStatus: 'Applied',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      summary: parsed.summary || 'Processed by AI',
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      suggestedStatus: ['Applied', 'Interviewing', 'Offer', 'Rejected'].includes(parsed.suggestedStatus)
        ? parsed.suggestedStatus
        : 'Applied',
    };
  } catch (error) {
    console.error('LLM summarization error:', error.message);
    // Fallback: return basic info if LLM fails
    return {
      summary: emailContent.substring(0, 100) + '...',
      actionItems: ['Review email manually'],
      suggestedStatus: 'Applied',
    };
  }
}

module.exports = { summarizeEmail };
