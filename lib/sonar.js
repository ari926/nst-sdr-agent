/**
 * lib/sonar.js
 *
 * Thin wrapper around Perplexity Sonar API for tasks the agent needs
 * outside of the main /research flow:
 *
 *   - findContacts({company, domain, target_roles}) → returns named people at the company
 *   - enrichOrg({company, domain})                   → returns Salesforce-shaped Account fields
 *   - emailPattern(domain)                           → guesses email format from web evidence
 *
 * All calls use response_format json_schema so output is structured.
 *
 * Uses PERPLEXITY_API_KEY (already required by server.js).
 */

const PPLX_URL = "https://api.perplexity.ai/chat/completions";
const MODEL = process.env.SONAR_MODEL || "sonar-pro";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const CONTACTS_SCHEMA = {
  name: "sonar_find_contacts",
  schema: {
    type: "object",
    properties: {
      contacts: {
        type: "array",
        description: "Named individuals found at the target company in the requested roles. Only include people whose names AND titles are verifiable from public sources (LinkedIn, company website, press releases, SEC filings).",
        items: {
          type: "object",
          properties: {
            first_name: { type: "string" },
            last_name: { type: "string" },
            title: { type: "string", description: "Exact current job title as listed on LinkedIn / company site" },
            seniority: {
              type: "string",
              description: "C-Suite, VP, Director, Manager, GM, or Other",
              enum: ["C-Suite", "VP", "Director", "Manager", "GM", "Other"],
            },
            department: {
              type: "string",
              description: "Executive, Operations, Finance, Compliance, Sales, IT, HR, Other",
            },
            linkedin_url: { type: "string", description: "Direct LinkedIn profile URL if found" },
            email_guess: {
              type: "string",
              description: "Best-effort email based on the company's pattern (e.g., firstname.lastname@domain). Leave blank if pattern unknown.",
            },
            email_confidence: {
              type: "string",
              enum: ["verified", "high", "medium", "low", "unknown"],
              description: "verified = found a real email; high = pattern confirmed elsewhere; medium = pattern inferred; low = pure guess; unknown = no email at all",
            },
            source_url: { type: "string", description: "Where you found this person" },
            notes: { type: "string", description: "Brief context — tenure, prior role, anything notable. <100 chars." },
          },
          required: ["first_name", "last_name", "title", "seniority"],
        },
      },
      email_pattern: {
        type: "string",
        description: "The detected email format at this company, e.g., 'firstinitial+lastname@domain', 'firstname.lastname@domain', or 'unknown'.",
      },
      sources: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["contacts", "sources"],
  },
};

const ORG_ENRICH_SCHEMA = {
  name: "sonar_org_enrich",
  schema: {
    type: "object",
    properties: {
      website: { type: "string" },
      phone: { type: "string", description: "Main corporate phone, E.164 if possible" },
      billing_state: { type: "string", description: "2-letter HQ state" },
      billing_city: { type: "string" },
      billing_street: { type: "string" },
      billing_postal: { type: "string" },
      number_of_employees: { type: "integer" },
      industry_hint: { type: "string", description: "Plain-English industry — NOT the NST picklist value" },
      description: { type: "string", description: "2-3 sentence company summary" },
      legal_name: { type: "string", description: "Full legal entity name if different from common name" },
      linkedin_url: { type: "string", description: "Company LinkedIn page URL" },
      location_count: { type: "integer", description: "Number of branches / stores / facilities" },
      sources: { type: "array", items: { type: "string" } },
    },
    required: ["description", "sources"],
  },
};

// ─── Core caller ─────────────────────────────────────────────────────────────

async function callSonar(systemPrompt, userPrompt, schema, temperature = 0.1) {
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
      response_format: { type: "json_schema", json_schema: schema },
    }),
  });

  if (!apiRes.ok) {
    const errBody = await apiRes.text();
    throw { status: apiRes.status, message: errBody };
  }

  const completion = await apiRes.json();
  const content = completion.choices[0].message.content;
  try {
    return {
      data: JSON.parse(content),
      usage: completion.usage || null,
      citations: completion.citations || null,
    };
  } catch {
    return { data: null, raw: content, usage: completion.usage || null };
  }
}

// ─── Find Contacts ───────────────────────────────────────────────────────────

const CONTACT_FINDER_SYSTEM = `You are a B2B contact research specialist. Your job is to find named individuals at a target company using public web sources (LinkedIn, company "About" / "Team" / "Leadership" pages, press releases, SEC filings, news articles).

CRITICAL RULES:
- Only return people whose names AND current titles are verifiable in public sources from the last 24 months.
- Do NOT invent names. If you cannot find verified people, return an empty contacts array.
- LinkedIn URLs must be real (use direct profile URLs you've seen referenced, not constructed guesses).
- Include the source URL for each person.
- Email format guessing: ONLY guess if you can see at least one example of an employee email pattern from the same domain in your research. If you can't see a pattern, leave email_guess blank and set email_confidence = "unknown".
- Prefer current employees over former. Skip anyone whose LinkedIn shows they've left.
- Sort results by seniority: C-Suite > VP > Director > Manager > GM > Other.`;

async function findContacts({ company_name, company_domain, target_roles = ["CEO", "CFO", "COO", "VP Operations", "Director of Operations", "Compliance", "General Manager"], limit = 10 }) {
  const rolesList = target_roles.join(", ");
  const userPrompt = `Find named leadership and operations contacts at this company:

Company: ${company_name}
${company_domain ? `Domain: ${company_domain}` : ""}

Target roles (in priority order): ${rolesList}

Return up to ${limit} of the most senior verified people in these roles. For each:
- Full name
- Exact current title
- LinkedIn profile URL (if you can find it)
- Best-effort email based on the company's observable email pattern (leave blank if unknown)
- The source URL where you verified their identity

Also detect the company's email format if visible (e.g., firstname.lastname@domain).

Search LinkedIn, the company's leadership/team page, press releases, and SEC filings (if public). Do not invent names.`;

  return callSonar(CONTACT_FINDER_SYSTEM, userPrompt, CONTACTS_SCHEMA, 0.0);
}

// ─── Enrich Org ──────────────────────────────────────────────────────────────

const ORG_ENRICH_SYSTEM = `You are a B2B account data researcher. Pull factual, citation-backed information about a company from public sources (their website, LinkedIn, SEC filings, state regulator databases, news). Do not invent data — leave fields blank if not found.`;

async function enrichOrg({ company_name, company_domain }) {
  const userPrompt = `Pull standard Salesforce Account fields for this company:

Company: ${company_name}
${company_domain ? `Domain: ${company_domain}` : ""}

Find: official website, main phone, HQ address (street, city, state, postal), employee count, plain-English industry, 2-3 sentence description, legal name, company LinkedIn URL, location/branch count.

Cite sources for each. Leave fields blank rather than guessing.`;

  return callSonar(ORG_ENRICH_SYSTEM, userPrompt, ORG_ENRICH_SCHEMA, 0.0);
}

module.exports = {
  findContacts,
  enrichOrg,
};
