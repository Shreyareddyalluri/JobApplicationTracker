/**
 * Smoke test for the heuristic classifier + LLM summarization pipeline.
 *
 * Classification tests run WITHOUT Ollama (instant heuristics).
 * Summarization tests require Ollama running: ollama serve
 * 
 * Run:  node test-llm.js
 * Run classification only (no Ollama needed):  node test-llm.js --classify-only
 */

require("dotenv").config();
const { isJobEmail, summarizeEmail } = require("./llm");

const classifyOnly = process.argv.includes("--classify-only");

// ── Test cases from the user's real inbox ──────────────────────────────────

const TEST_CASES = [
  // NOTE: J.E. Dunn is blocked by gmail.js's BULK_SENDER_PATTERNS (noreply.jobs2web.com)
  // BEFORE it ever reaches isJobEmail(). The heuristic classifier alone would accept it
  // because it contains "application", but that's fine — the pipeline is layered.
  {
    name: "J.E. Dunn job agent digest (blocked by bulk filter in gmail.js, not here)",
    expectedClassification: true, // isJobEmail() alone accepts it; gmail.js bulk filter catches it
    email: `Subject: Your Job Agent matched new jobs
From: jedunnp-jobnotification@noreply.jobs2web.com
Body: You are receiving this email because you joined the J.E. Dunn Construction Group Inc P Talent Community on 1/16/26. You will receive these messages every 7 day(s). Your Job Agent (Application Developer 1, Kansas City MO US) matched the following jobs at jobs.jedunn.com. M/E Engineer 2, Mission Critical - Kansas City, MO. Project Manager 1, Self Perform (AFG) - Kansas City, MO. Update your preferences. Add another job agent. Change the job agent frequency. Forward these jobs to any of your friends.`,
  },
  {
    name: "Triple Cash Back promo",
    expectedClassification: false,
    email: `Subject: ⭐⭐⭐Triple Cash Back is HERE ⭐⭐⭐
From: deals@rakuten.com
Body: Triple Cash Back is HERE - shop through Rakuten and earn triple cash back at your favorite stores. Sale ends tonight!`,
  },
  {
    name: "OTP verification email",
    expectedClassification: false,
    email: `Subject: One-Time Password for Candidate Account Verification
From: noreply@workday.com
Body: Your one-time password is 847291. This code expires in 10 minutes.`,
  },
  {
    name: "Verify your identity",
    expectedClassification: false,
    email: `Subject: Verify Your Identity
From: security@somesite.com
Body: Please verify your identity by clicking the link below. This is required to access your account.`,
  },

  // ---- Should be ACCEPTED by classifier (real application emails) ----
  {
    name: "Tyler Technologies rejection",
    expectedClassification: true,
    expectedStatus: "Rejected",
    email: `Subject: Your application for Software Engineer at Tyler Technologies
From: Tyler Technologies Recruiting Team <reply@careers.tylertech.com>
Body: Hi Shreya Reddy, Thank you for taking the time to apply with us at Tyler Technologies. After careful consideration of your background and experience, we won't be moving forward with your application for the role of Software Engineer at this time. If you've applied for other positions, that's great! Our recruiting team reviews each application separately, so if we think you might be a match for another role, we'll definitely let you know. We appreciate your interest in us and wish you every success. Thank you, The Tyler Technologies Recruiting Team`,
  },
  {
    name: "Aspida rejection",
    expectedClassification: true,
    expectedStatus: "Rejected",
    email: `Subject: Application at Aspida
From: Aspida Financial Services LLC <do-not-reply@mail.paylocity.com>
Body: Dear Shreya Reddy, Thank you for your interest in our open position, Software Engineer. We have reviewed your application and regret to inform you that it has not been selected for further consideration. We wish you success with your job search and thank you for your interest in Aspida Financial Services LLC. Sincerely, Aspida Financial Services LLC`,
  },
  {
    name: "Intuit interview scheduling",
    expectedClassification: true,
    expectedStatus: "Interviewing",
    email: `Subject: Your 1:1 with Intuit Recruiting has been scheduled
From: recruiting@intuit.com
Body: Hi Shreya Reddy, Your 30-minute 1:1 with our recruiter has been scheduled. Here's what to expect: Duration: 30 minutes. Format: Video call (link in your calendar invite). Important: Please come prepared to share a recent project you've worked on where you used an AI assistant for at least one development task. You should be ready to: Share your screen. Walk us through the project in simple, non-technical terms. Explain different parts of the code if asked. Clearly describe where and how you used AI. This is not a live coding interview. We are primarily evaluating communication, ownership, and how you work with AI as a tool. Best, Intuit Recruiting Team`,
  },
  {
    name: "Stripe rejection",
    expectedClassification: true,
    expectedStatus: "Rejected",
    email: `Subject: Update on your application to Stripe
From: university-recruiting@stripe.com
Body: Hi Shreya Reddy, Thank you so much for your interest in joining Stripe! We have had a number of qualified applicants and are on track to fill our Software Engineer, New Grad class in our AMER offices. Unfortunately, we have made the difficult decision not to move forward with your candidacy at this time, but want to thank you for your patience while we reviewed all of our submissions. We encourage you to revisit our jobs page in the fall to see what opportunities might interest you. The University Recruiting team wishes you the best of luck in your search. Best, Stripe University Recruiting`,
  },
  {
    name: "Procore rejection",
    expectedClassification: true,
    expectedStatus: "Rejected",
    email: `Subject: Update regarding your application at Procore Technologies
From: talent-acquisition@procore.com
Body: Hi Shreya Reddy, Thank you again for your interest in the Senior Software Engineer, Full-Stack position at Procore Technologies. We truly appreciate the time, energy, and thoughtfulness you put into your application and interview process. After careful consideration, we've concluded interviews and have decided to move forward with another candidate for this role. That said, this decision in no way reflects negatively on your qualifications or potential. While this opportunity didn't align at this time, we'd love to stay connected. Warm regards, The Procore Talent Acquisition Team`,
  },
  {
    name: "Application confirmation (generic)",
    expectedClassification: true,
    expectedStatus: "Applied",
    email: `Subject: Application received - Software Engineer at Acme Corp
From: careers@acmecorp.com
Body: Hi Shreya, Thank you for applying to the Software Engineer position at Acme Corp. We have received your application and will review it shortly. We'll be in touch if your qualifications match our requirements. Best regards, Acme Corp Hiring Team`,
  },
  {
    name: "Thanks for applying to Google",
    expectedClassification: true,
    expectedStatus: "Applied",
    email: `Subject: Thanks for applying to Google
From: staffing@google.com
Body: Hi Shreya, Thanks for applying to Google! We received your application for Software Engineer. Our team will review your background and experience, and we'll be in touch. Best, Google Staffing`,
  },
  {
    name: "Tesla application received",
    expectedClassification: true,
    expectedStatus: "Applied",
    email: `Subject: Thank you – we've received your Tesla application
From: do-not-reply@tesla.com
Body: Hi Shreya Reddy, Thank you for your interest in Tesla. We have received your application for Software Engineer. Our recruiting team will review your qualifications and reach out if there's a match. Best, Tesla Recruiting`,
  },
  {
    name: "NIKE Application Update",
    expectedClassification: true,
    email: `Subject: NIKE - Application Update
From: careers@nike.com
Body: Hi Shreya, We wanted to provide you with an update on your application for Software Engineer at NIKE. Your application is currently under review. We'll be in touch with next steps. Best, NIKE Talent Acquisition`,
  },
  {
    name: "Follow-up on Stackline application",
    expectedClassification: true,
    email: `Subject: Follow-up on your application with Stackline
From: recruiting@stackline.com
Body: Hi Shreya, Thank you for your continued interest in Stackline. We wanted to follow up on your application for the Software Engineer role. Best, Stackline Recruiting`,
  },
];

// ── Runner ─────────────────────────────────────────────────────────────────

async function runTests() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║     Heuristic + LLM Classification & Status Tests   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  if (classifyOnly) {
    console.log("  (--classify-only mode: skipping LLM summarization tests)\n");
  }

  let passed = 0;
  let failed = 0;

  for (const tc of TEST_CASES) {
    console.log(`── ${tc.name} ──`);

    // Test 1: Classification (heuristic — no LLM, instant)
    const isJob = await isJobEmail(tc.email);
    const classOk = isJob === tc.expectedClassification;
    console.log(
      `  Classification: ${isJob ? "YES (job email)" : "NO (not job email)"}` +
        `  ${classOk ? "✅" : "❌ EXPECTED " + (tc.expectedClassification ? "YES" : "NO")}`,
    );
    if (classOk) passed++;
    else failed++;

    // Test 2: Status (LLM summarization — only for accepted job emails)
    if (!classifyOnly && tc.expectedClassification && tc.expectedStatus) {
      const result = await summarizeEmail(tc.email);
      const statusOk = result.suggestedStatus === tc.expectedStatus;
      console.log(
        `  Status: ${result.suggestedStatus}` +
          `  ${statusOk ? "✅" : "❌ EXPECTED " + tc.expectedStatus}`,
      );
      console.log(`  Summary: ${result.summary}`);
      if (result.actionItems.length > 0) {
        console.log(`  Actions: ${result.actionItems.join("; ")}`);
      }
      if (statusOk) passed++;
      else failed++;
    }

    console.log();
  }

  console.log("═══════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} checks`);
  console.log("═══════════════════════════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
