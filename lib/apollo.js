/**
 * Apollo.io client — OPTIONAL enrichment provider.
 *
 * This module exposes the same interface as lib/sonar.js so the agent can
 * swap providers based on environment configuration.
 *
 * If APOLLO_API_KEY is not set, every call throws "Apollo not configured" and
 * the caller is expected to fall back to lib/sonar.js.
 *
 * Apollo Basic ($49/mo) gives:
 *   - POST /v1/organizations/enrich  → org snapshot (employees, revenue, phone, LinkedIn, address)
 *   - POST /v1/people/search         → people at org, filtered by title/seniority
 *   - POST /v1/people/match          → 1 credit per verified person record (email, LinkedIn, phone async)
 *
 * Docs: https://docs.apollo.io/reference
 */

const APOLLO_API_KEY = process.env.APOLLO_API_KEY || null;
const APOLLO_BASE = "https://api.apollo.io/v1";

function requireKey() {
  if (!APOLLO_API_KEY) {
    const err = new Error("Apollo not configured (APOLLO_API_KEY missing)");
    err.code = "APOLLO_NOT_CONFIGURED";
    throw err;
  }
}

async function apolloPost(path, body) {
  requireKey();
  const res = await fetch(`${APOLLO_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": APOLLO_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apollo ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Enrich an organization by domain (Apollo's strongest match key).
 * Falls back to name+location lookup if domain missing.
 *
 * Returns the same shape as lib/sonar.enrichOrg() so callers can swap.
 */
async function enrichOrg({ company_name, company_domain }) {
  requireKey();
  if (!company_domain && !company_name) {
    throw new Error("enrichOrg requires company_name or company_domain");
  }

  const body = company_domain
    ? { domain: company_domain }
    : { organization_name: company_name };

  const json = await apolloPost("/organizations/enrich", body);
  const o = json.organization || {};

  return {
    website: o.website_url || null,
    phone: o.phone || o.primary_phone?.number || null,
    billing_street: o.street_address || null,
    billing_city: o.city || null,
    billing_state: o.state || null,
    billing_postal: o.postal_code || null,
    billing_country: o.country || null,
    employee_count: o.estimated_num_employees || null,
    industry_hint: o.industry || null,
    description: o.short_description || null,
    legal_name: o.name || null,
    linkedin_url: o.linkedin_url || null,
    location_count: Array.isArray(o.locations) ? o.locations.length : null,
    sources: [`apollo:${o.id || company_domain || company_name}`],
    _raw: o,
  };
}

/**
 * Find contacts at an organization by title/seniority.
 *
 * IMPORTANT — Apollo phone caveat:
 *   /people/match does NOT include direct phone by default. Phone is an async
 *   request that requires polling a separate endpoint. We do NOT implement
 *   that here. Treat phone fields as best-effort (often null).
 *
 * Returns the same shape as lib/sonar.findContacts().
 */
async function findContacts({
  company_name,
  company_domain,
  target_roles = ["CFO", "VP Finance", "Director of Operations", "Controller", "Treasurer"],
  limit = 3,
}) {
  requireKey();

  // 1. Search for people at the company
  const searchBody = {
    page: 1,
    per_page: Math.max(limit * 2, 10),
    person_titles: target_roles,
    q_organization_domains: company_domain ? [company_domain] : undefined,
    organization_names: company_domain ? undefined : [company_name],
  };

  const search = await apolloPost("/mixed_people/search", searchBody);
  const peopleStubs = (search.people || []).slice(0, limit);

  // 2. Enrich each top result (1 credit each) to unmask name + get verified email
  const enriched = [];
  for (const stub of peopleStubs) {
    try {
      const match = await apolloPost("/people/match", {
        id: stub.id,
        reveal_personal_emails: false,
        reveal_phone_number: false,
      });
      const p = match.person || stub;
      enriched.push({
        first_name: p.first_name || null,
        last_name: p.last_name || null,
        title: p.title || null,
        seniority: p.seniority || null,
        department: Array.isArray(p.departments) ? p.departments[0] : null,
        linkedin_url: p.linkedin_url || null,
        email_guess: p.email || null,
        email_confidence: p.email_status === "verified" ? "verified" : (p.email ? "guessed" : "unknown"),
        source_url: p.linkedin_url || null,
        notes: p.email_status || null,
      });
    } catch (e) {
      // Fall through with stub data
      enriched.push({
        first_name: stub.first_name || null,
        last_name: stub.last_name || null,
        title: stub.title || null,
        seniority: stub.seniority || null,
        department: Array.isArray(stub.departments) ? stub.departments[0] : null,
        linkedin_url: stub.linkedin_url || null,
        email_guess: null,
        email_confidence: "unknown",
        source_url: stub.linkedin_url || null,
        notes: `enrich_failed: ${e.message}`,
      });
    }
  }

  return {
    contacts: enriched,
    email_pattern: null, // Apollo doesn't expose pattern directly
    sources: [`apollo:search:${company_domain || company_name}`],
  };
}

function isConfigured() {
  return !!APOLLO_API_KEY;
}

module.exports = {
  enrichOrg,
  findContacts,
  isConfigured,
};
