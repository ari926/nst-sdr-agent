/**
 * NST SDR Intelligence Agent
 *
 * A minimal Express service that accepts SDR research requests
 * and returns structured, web-grounded intelligence via Perplexity
 * Sonar API (OpenAI-compatible client).
 *
 * Usage:
 *   POST /nst-sdr-agent   →  structured JSON research + outreach
 *   GET  /health           →  { status: "ok" }
 */

require("dotenv").config();
const express = require("express");

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MODEL = process.env.SONAR_MODEL || "sonar-pro";
const PPLX_URL = "https://api.perplexity.ai/chat/completions";

if (!process.env.PERPLEXITY_API_KEY) {
  console.error("FATAL: PERPLEXITY_API_KEY is not set. Copy .env.example → .env and add your key.");
  process.exit(1);
}

// ─── System Prompt (the "brain" of the SDR agent) ────────────────────────────
const SYSTEM_PROMPT = `You are an SDR research and personalization copilot for NST (National Secure Transport), an armored carrier and cash logistics company selling B2B services to revenue teams. NST provides CIT (cash-in-transit), smart safes, ATM servicing, and Federal Reserve logistics as an infrastructure-grade alternative to Brink's and Loomis. NST's footprint covers NJ, NY, PA, CT, DE, MA, IL, and MO.

Your job is to:
1) Research the target company and contact using the live web.
2) Extract only sales-relevant insights.
3) Generate concise, highly personalized outreach.

Always ground claims in verifiable public information, avoid guessing, and keep outputs structured and easy to paste into CRM/sequences. If information is missing or ambiguous, say so explicitly.`;

// ─── Output JSON Schema ──────────────────────────────────────────────────────
const OUTPUT_SCHEMA = {
  name: "nst_sdr_output",
  schema: {
    type: "object",
    properties: {
      company_snapshot: {
        type: "object",
        description: "5-10 bullet account summary",
        properties: {
          what_they_do: { type: "string" },
          who_they_serve: { type: "string" },
          how_they_make_money: { type: "string" },
          size_and_stage: { type: "string" },
          tech_stack_or_tools: { type: "string" },
          recent_news_or_funding: { type: "string" },
          headquarters: { type: "string" },
          relevant_competitors: { type: "string" },
        },
        required: [
          "what_they_do",
          "who_they_serve",
          "how_they_make_money",
          "size_and_stage",
        ],
      },
      contact_dossier: {
        type: "object",
        description: "Key info about the contact person",
        properties: {
          full_name: { type: "string" },
          current_title: { type: "string" },
          tenure_at_company: { type: "string" },
          prior_roles: { type: "string" },
          published_content_or_quotes: { type: "string" },
          likely_priorities: { type: "string" },
        },
        required: ["full_name", "current_title"],
      },
      high_signal_triggers: {
        type: "array",
        description: "Compelling events for outreach timing (funding, hiring, leadership change, expansion, product launch, etc.)",
        items: { type: "string" },
      },
      recommended_angles: {
        type: "array",
        description: "Map NST value props to triggers — e.g., 'Help new team ramp after Series B hiring push'",
        items: { type: "string" },
      },
      email_variants: {
        type: "array",
        description: "2-3 short email variants (80-150 words each), each referencing at least one high_signal_trigger",
        items: {
          type: "object",
          properties: {
            variant_label: { type: "string" },
            subject_line: { type: "string" },
            body: { type: "string" },
          },
          required: ["variant_label", "subject_line", "body"],
        },
      },
      sources: {
        type: "array",
        description: "URLs used during research",
        items: { type: "string" },
      },
    },
    required: [
      "company_snapshot",
      "contact_dossier",
      "high_signal_triggers",
      "recommended_angles",
      "email_variants",
      "sources",
    ],
  },
};

// ─── Input Validation ────────────────────────────────────────────────────────
function validateInput(body) {
  const errors = [];
  if (!body.company_name || typeof body.company_name !== "string")
    errors.push("company_name (string) is required");
  if (!body.company_domain || typeof body.company_domain !== "string")
    errors.push("company_domain (string) is required");
  if (!body.contact_full_name || typeof body.contact_full_name !== "string")
    errors.push("contact_full_name (string) is required");
  if (!body.contact_title || typeof body.contact_title !== "string")
    errors.push("contact_title (string) is required");
  return errors;
}

// ─── Build the user prompt from input fields ─────────────────────────────────
function buildUserPrompt(input) {
  let prompt = `Research the following account and contact for SDR outreach:\n\n`;
  prompt += `Company: ${input.company_name}\n`;
  prompt += `Domain: ${input.company_domain}\n`;
  prompt += `Contact: ${input.contact_full_name}, ${input.contact_title}\n`;

  if (input.contact_linkedin_url)
    prompt += `LinkedIn: ${input.contact_linkedin_url}\n`;
  if (input.company_linkedin_url)
    prompt += `Company LinkedIn: ${input.company_linkedin_url}\n`;
  if (input.industry_hint) prompt += `Industry hint: ${input.industry_hint}\n`;
  if (input.current_sequence_goal)
    prompt += `Sequence goal: ${input.current_sequence_goal}\n`;
  if (input.tone_preference)
    prompt += `Tone preference: ${input.tone_preference}\n`;

  prompt += `\nReturn structured JSON with: company_snapshot, contact_dossier, high_signal_triggers, recommended_angles, email_variants (2-3), and sources.`;
  return prompt;
}

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", model: MODEL, timestamp: new Date().toISOString() });
});

// Main endpoint
app.post("/nst-sdr-agent", async (req, res) => {
  // 1. Validate
  const errors = validateInput(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: "Validation failed", details: errors });
  }

  // 2. Build prompt
  const userMessage = buildUserPrompt(req.body);

  // 3. Call Perplexity Sonar via direct HTTP (no SDK needed)
  try {
    const apiRes = await fetch(PPLX_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.2,
        response_format: {
          type: "json_schema",
          json_schema: OUTPUT_SCHEMA,
        },
      }),
    });

    if (!apiRes.ok) {
      const errBody = await apiRes.text();
      console.error(`Perplexity API ${apiRes.status}:`, errBody);
      return res.status(apiRes.status).json({
        error: "Perplexity API call failed",
        status: apiRes.status,
        message: errBody,
      });
    }

    const completion = await apiRes.json();
    const content = completion.choices[0].message.content;
    let parsed;

    try {
      parsed = JSON.parse(content);
    } catch {
      // Sonar returned text instead of JSON — return raw
      return res.json({
        warning: "Model returned non-JSON. Raw content included.",
        raw: content,
        usage: completion.usage || null,
      });
    }

    return res.json({
      result: parsed,
      model: completion.model,
      usage: completion.usage || null,
      citations: completion.citations || null,
    });
  } catch (err) {
    console.error("Perplexity API error:", err.message);
    return res.status(502).json({
      error: "Perplexity API call failed",
      message: err.message,
    });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`NST SDR Agent listening on http://0.0.0.0:${PORT}`);
  console.log(`Model: ${MODEL}`);
});
