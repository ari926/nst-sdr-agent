/**
 * NST SDR Intelligence Agent v2
 *
 * A comprehensive sales intelligence engine for National Secure Transport.
 * Powered by Perplexity Sonar API with deep NST business context.
 *
 * Endpoints:
 *   POST /research      → Full prospect research + outreach (primary)
 *   POST /call-prep     → Pre-meeting briefing for a known account
 *   POST /enrich        → Quick account enrichment (minimal, fast)
 *   GET  /health        → { status: "ok" }
 */

require("dotenv").config();
const express = require("express");

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MODEL = process.env.SONAR_MODEL || "sonar-pro";
const PPLX_URL = "https://api.perplexity.ai/chat/completions";

if (!process.env.PERPLEXITY_API_KEY) {
  console.error("FATAL: PERPLEXITY_API_KEY is not set.");
  process.exit(1);
}

// ─── System Prompt: The Brain ────────────────────────────────────────────────
const SYSTEM_PROMPT = require("./system-prompt");

// ─── Output Schemas ─────────────────────────────────────────────────────────

// Full research schema — maps to Salesforce fields
const RESEARCH_SCHEMA = {
  name: "nst_sdr_research",
  schema: {
    type: "object",
    properties: {
      // ── Salesforce Account fields ──
      sf_account: {
        type: "object",
        description: "Fields that map directly to a Salesforce Account record",
        properties: {
          Name: { type: "string", description: "Company name (official)" },
          Industry: {
            type: "string",
            description: "Must be one of: MSB Money Transmitter, MSB Check Casher, MSB Transmitter & Check Casher, MSB ATM Services, MSB Crypto ATMs, MSB Gaming & Gambling, QSR, C-Store/Supermarket, Gov/School/Healthcare, Other Retail, Cash-Intensive Retail, Regulated Business, FI with MSB Division, FI with Commercial Banking Division, Other FI w/ Biz Banking Division, Strategic Partner, HQ/Other Office Only, Unclassified. NEVER use cannabis, marijuana, MRB, dispensary, or cultivator in any classification.",
          },
          Website: { type: "string", description: "Company website URL" },
          Phone: { type: "string", description: "Main phone number" },
          BillingState: { type: "string", description: "HQ state (2-letter)" },
          BillingCity: { type: "string", description: "HQ city" },
          NumberOfEmployees: { type: "integer", description: "Estimated employee count" },
          Description: {
            type: "string",
            description: "2-3 sentence company summary for the Salesforce record. Include what they do, how many locations, and any relevant cash/logistics details.",
          },
          Market_Size__c: {
            type: "string",
            description: "ENT (multi-state, 10+ locations, or bank with $1B+ assets) or SMB (single state, under 10 locations)",
          },
          Territory__c: {
            type: "string",
            description: "Must be one of: SMB Mid-Atlantic, SMB New England, SMB Mid West, Enterprise. Based on HQ location and size.",
          },
        },
        required: ["Name", "Industry", "BillingState", "Description", "Market_Size__c"],
      },

      // ── Salesforce Contact fields ──
      sf_contact: {
        type: "object",
        description: "Fields for the primary contact in Salesforce",
        properties: {
          FirstName: { type: "string" },
          LastName: { type: "string" },
          Title: { type: "string" },
          Email: { type: "string" },
          Phone: { type: "string" },
          Description: {
            type: "string",
            description: "Brief contact background — tenure, prior roles, relevant experience",
          },
        },
        required: ["FirstName", "LastName", "Title"],
      },

      // ── Salesforce Opportunity fields ──
      sf_opportunity: {
        type: "object",
        description: "Suggested Opportunity record fields",
        properties: {
          Name: {
            type: "string",
            description: "Use format: NEW - [STATE] - [PRODUCT]. Example: 'NEW - NJ - CIT/CVS'",
          },
          StageName: {
            type: "string",
            description: "Always 'Intro' for new prospects",
            enum: ["Intro"],
          },
          Type: {
            type: "string",
            enum: ["New Business", "Renewal", "Expansion"],
          },
          LeadSource: {
            type: "string",
            description: "How this lead was sourced",
          },
          NextStep: {
            type: "string",
            description: "Recommended next action — e.g., 'Send intro email' or 'Request intro via [bank partner]'",
          },
        },
        required: ["Name", "StageName", "Type", "NextStep"],
      },

      // ── Intelligence (not in SF, for the rep) ──
      intelligence: {
        type: "object",
        properties: {
          vertical_fit_score: {
            type: "string",
            description: "HIGH / MEDIUM / LOW based on NST's win rate data for this vertical",
          },
          estimated_products: {
            type: "array",
            description: "Which NST products this prospect likely needs. From: CIT, CVS, ATM, SMS (Smart Safe), PMT, FI Virtual Vault, FI Branch CIT, FI Bank Drops, Recycler",
            items: { type: "string" },
          },
          location_count: {
            type: "integer",
            description: "Number of locations/branches if findable",
          },
          current_carrier: {
            type: "string",
            description: "Current armored carrier if mentioned anywhere (Brink's, Loomis, Garda, Dunbar, etc.)",
          },
          pain_signals: {
            type: "array",
            description: "Specific pain points found: service complaints, security incidents, compliance gaps, expansion needs",
            items: { type: "string" },
          },
          competitive_angle: {
            type: "string",
            description: "The single strongest angle to lead with based on this prospect's situation",
          },
          recommended_rep: {
            type: "string",
            description: "Which NST rep should own this: Joe Wentzell (bank relationships), John Tucker (bank ops/marketing), Jason Wingate (retail Mid-Atlantic), Shannon Guilmet (retail New England/Midwest)",
          },
          confidence: {
            type: "string",
            description: "How confident you are in this research: HIGH (multiple sources confirm), MEDIUM (some info found), LOW (limited public info)",
          },
        },
        required: [
          "vertical_fit_score",
          "estimated_products",
          "pain_signals",
          "competitive_angle",
          "recommended_rep",
          "confidence",
        ],
      },

      // ── Outreach ──
      email_variants: {
        type: "array",
        description: "2-3 personalized email drafts. Each under 150 words. First line must reference something specific about the prospect, not NST.",
        items: {
          type: "object",
          properties: {
            variant_label: {
              type: "string",
              description: "e.g., 'Pain-led (Brink's switch)', 'Compliance-led', 'Expansion-led'",
            },
            from_rep: {
              type: "string",
              description: "Which rep this should come from",
            },
            subject_line: { type: "string" },
            body: { type: "string" },
          },
          required: ["variant_label", "from_rep", "subject_line", "body"],
        },
      },

      // ── Call script for first conversation ──
      call_script: {
        type: "object",
        description: "A brief cold call opening script",
        properties: {
          opener: {
            type: "string",
            description: "First 2 sentences — pattern interrupt + relevance. Under 30 words.",
          },
          qualifying_questions: {
            type: "array",
            description: "3-4 questions to ask to qualify the prospect",
            items: { type: "string" },
          },
          objection_handlers: {
            type: "array",
            description: "2-3 likely objections and how to handle them",
            items: {
              type: "object",
              properties: {
                objection: { type: "string" },
                response: { type: "string" },
              },
              required: ["objection", "response"],
            },
          },
        },
        required: ["opener", "qualifying_questions"],
      },

      sources: {
        type: "array",
        description: "All URLs used during research",
        items: { type: "string" },
      },
    },
    required: [
      "sf_account",
      "sf_contact",
      "sf_opportunity",
      "intelligence",
      "email_variants",
      "call_script",
      "sources",
    ],
  },
};

// Call prep schema — for pre-meeting briefings
const CALL_PREP_SCHEMA = {
  name: "nst_call_prep",
  schema: {
    type: "object",
    properties: {
      company_update: {
        type: "string",
        description: "What's new with this company since the last touch? Recent news, hires, expansions, regulatory changes. 3-5 bullet points.",
      },
      contact_update: {
        type: "string",
        description: "Any new info on the contact — new role, recent posts, speaking engagements, published content.",
      },
      talking_points: {
        type: "array",
        description: "3-5 specific talking points for the meeting, grounded in research",
        items: { type: "string" },
      },
      questions_to_ask: {
        type: "array",
        description: "4-6 discovery questions tailored to this account",
        items: { type: "string" },
      },
      competitive_intel: {
        type: "string",
        description: "Any mentions of their current carrier, recent RFPs, or switching signals",
      },
      risk_factors: {
        type: "array",
        description: "What could make this deal stall or die",
        items: { type: "string" },
      },
      sources: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "company_update",
      "talking_points",
      "questions_to_ask",
      "sources",
    ],
  },
};

// Quick enrich schema — minimal, fast
const ENRICH_SCHEMA = {
  name: "nst_enrich",
  schema: {
    type: "object",
    properties: {
      industry: { type: "string", description: "NST industry classification" },
      description: { type: "string", description: "2-sentence company summary" },
      location_count: { type: "integer" },
      hq_state: { type: "string" },
      hq_city: { type: "string" },
      website: { type: "string" },
      employee_count: { type: "integer" },
      market_size: { type: "string", description: "ENT or SMB" },
      recommended_products: {
        type: "array",
        items: { type: "string" },
      },
      vertical_fit: { type: "string", description: "HIGH / MEDIUM / LOW" },
      sources: { type: "array", items: { type: "string" } },
    },
    required: ["industry", "description", "hq_state", "vertical_fit"],
  },
};

// ─── Input Validation ────────────────────────────────────────────────────────
function validateResearch(body) {
  const errors = [];
  if (!body.company_name || typeof body.company_name !== "string")
    errors.push("company_name (string) is required");
  // Domain OR company_name is enough — agent can web search by name
  if (!body.contact_full_name || typeof body.contact_full_name !== "string")
    errors.push("contact_full_name (string) is required");
  if (!body.contact_title || typeof body.contact_title !== "string")
    errors.push("contact_title (string) is required");
  return errors;
}

function validateCallPrep(body) {
  const errors = [];
  if (!body.company_name) errors.push("company_name is required");
  if (!body.contact_full_name) errors.push("contact_full_name is required");
  return errors;
}

function validateEnrich(body) {
  const errors = [];
  if (!body.company_name) errors.push("company_name is required");
  return errors;
}

// ─── Prompt Builders ─────────────────────────────────────────────────────────

function buildResearchPrompt(input) {
  let prompt = `Research this prospect for NST sales outreach:\n\n`;
  prompt += `Company: ${input.company_name}\n`;
  if (input.company_domain) prompt += `Domain: ${input.company_domain}\n`;
  prompt += `Contact: ${input.contact_full_name}, ${input.contact_title}\n`;
  if (input.contact_email) prompt += `Email: ${input.contact_email}\n`;
  if (input.contact_linkedin_url) prompt += `LinkedIn: ${input.contact_linkedin_url}\n`;
  if (input.company_linkedin_url) prompt += `Company LinkedIn: ${input.company_linkedin_url}\n`;
  if (input.industry_hint) prompt += `Industry hint: ${input.industry_hint}\n`;
  if (input.lead_source) prompt += `Lead source: ${input.lead_source}\n`;
  if (input.existing_sf_notes) prompt += `Existing CRM notes: ${input.existing_sf_notes}\n`;
  if (input.sequence_goal) prompt += `Sequence goal: ${input.sequence_goal}\n`;

  prompt += `\nClassify this prospect into the correct NST vertical, assess fit, and generate Salesforce-ready fields plus personalized outreach. Use the output schema exactly.`;
  return prompt;
}

function buildCallPrepPrompt(input) {
  let prompt = `Prepare a pre-meeting briefing for an upcoming call/meeting:\n\n`;
  prompt += `Company: ${input.company_name}\n`;
  if (input.company_domain) prompt += `Domain: ${input.company_domain}\n`;
  prompt += `Contact: ${input.contact_full_name}`;
  if (input.contact_title) prompt += `, ${input.contact_title}`;
  prompt += `\n`;
  if (input.opportunity_stage) prompt += `Current stage: ${input.opportunity_stage}\n`;
  if (input.last_activity) prompt += `Last activity: ${input.last_activity}\n`;
  if (input.crm_notes) prompt += `CRM notes: ${input.crm_notes}\n`;
  if (input.products_discussed) prompt += `Products discussed: ${input.products_discussed}\n`;

  prompt += `\nFind the latest news, any changes at the company, and prepare specific talking points and discovery questions for this meeting. Focus on actionable intel, not generic advice.`;
  return prompt;
}

function buildEnrichPrompt(input) {
  let prompt = `Quick enrichment for NST CRM:\n\n`;
  prompt += `Company: ${input.company_name}\n`;
  if (input.company_domain) prompt += `Domain: ${input.company_domain}\n`;
  if (input.state_hint) prompt += `State: ${input.state_hint}\n`;

  prompt += `\nClassify into the correct NST industry vertical, estimate size, and recommend which NST products they'd need. Keep it concise.`;
  return prompt;
}

// ─── Perplexity API Call ─────────────────────────────────────────────────────
async function callPerplexity(systemPrompt, userPrompt, schema, temperature = 0.2) {
  const apiRes = await fetch(PPLX_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      response_format: {
        type: "json_schema",
        json_schema: schema,
      },
    }),
  });

  if (!apiRes.ok) {
    const errBody = await apiRes.text();
    throw { status: apiRes.status, message: errBody };
  }

  const completion = await apiRes.json();
  const content = completion.choices[0].message.content;

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      warning: "Model returned non-JSON",
      raw: content,
      usage: completion.usage || null,
    };
  }

  return {
    result: parsed,
    model: completion.model,
    usage: completion.usage || null,
    citations: completion.citations || null,
  };
}

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: "2.0.0",
    model: MODEL,
    endpoints: ["/research", "/call-prep", "/enrich"],
    timestamp: new Date().toISOString(),
  });
});

// ── Full Research (primary endpoint) ──
app.post("/research", async (req, res) => {
  const errors = validateResearch(req.body);
  if (errors.length > 0) return res.status(400).json({ error: "Validation failed", details: errors });

  try {
    const userPrompt = buildResearchPrompt(req.body);
    const response = await callPerplexity(SYSTEM_PROMPT, userPrompt, RESEARCH_SCHEMA);
    return res.json(response);
  } catch (err) {
    console.error("Research endpoint error:", err);
    return res.status(err.status || 502).json({ error: "API call failed", message: err.message });
  }
});

// ── Call Prep ──
app.post("/call-prep", async (req, res) => {
  const errors = validateCallPrep(req.body);
  if (errors.length > 0) return res.status(400).json({ error: "Validation failed", details: errors });

  try {
    const userPrompt = buildCallPrepPrompt(req.body);
    const response = await callPerplexity(SYSTEM_PROMPT, userPrompt, CALL_PREP_SCHEMA);
    return res.json(response);
  } catch (err) {
    console.error("Call-prep endpoint error:", err);
    return res.status(err.status || 502).json({ error: "API call failed", message: err.message });
  }
});

// ── Quick Enrich ──
app.post("/enrich", async (req, res) => {
  const errors = validateEnrich(req.body);
  if (errors.length > 0) return res.status(400).json({ error: "Validation failed", details: errors });

  try {
    const userPrompt = buildEnrichPrompt(req.body);
    const response = await callPerplexity(SYSTEM_PROMPT, userPrompt, ENRICH_SCHEMA, 0.1);
    return res.json(response);
  } catch (err) {
    console.error("Enrich endpoint error:", err);
    return res.status(err.status || 502).json({ error: "API call failed", message: err.message });
  }
});

// ── Legacy endpoint (backward compatible with v1) ──
app.post("/nst-sdr-agent", async (req, res) => {
  // Redirect to /research
  const errors = validateResearch(req.body);
  if (errors.length > 0) return res.status(400).json({ error: "Validation failed", details: errors });

  try {
    const userPrompt = buildResearchPrompt(req.body);
    const response = await callPerplexity(SYSTEM_PROMPT, userPrompt, RESEARCH_SCHEMA);
    return res.json(response);
  } catch (err) {
    console.error("Legacy endpoint error:", err);
    return res.status(err.status || 502).json({ error: "API call failed", message: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  NST SDR Intelligence Agent v2`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Endpoints:`);
  console.log(`    POST /research    — Full prospect research + outreach`);
  console.log(`    POST /call-prep   — Pre-meeting briefing`);
  console.log(`    POST /enrich      — Quick account enrichment`);
  console.log(`    GET  /health      — Health check`);
  console.log(`\n  Listening on http://0.0.0.0:${PORT}\n`);
});
