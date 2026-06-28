/**
 * Salesforce REST client — minimal, dependency-free.
 *
 * Auth: OAuth 2.0 Username-Password flow (Connected App required).
 * Required env vars:
 *   SF_CLIENT_ID         — Connected App consumer key
 *   SF_CLIENT_SECRET     — Connected App consumer secret
 *   SF_USERNAME          — Integration user username
 *   SF_PASSWORD          — Integration user password
 *   SF_SECURITY_TOKEN    — User security token (appended to password)
 *   SF_LOGIN_URL         — https://login.salesforce.com (default) or https://test.salesforce.com
 *   SF_API_VERSION       — default v60.0
 *
 * Token is cached in module scope and auto-refreshes on 401.
 *
 * Surface:
 *   getAccount(id, fields)         → object
 *   queryAccounts(soql)            → { totalSize, done, records }
 *   updateAccount(id, fields)      → { success: true, id }
 *   createContact(payload)         → { id }
 *   upsertContactByEmail(payload)  → { id, created }
 *   createTask(payload)            → { id }
 *   query(soql)                    → generic SOQL
 *   describe(object)               → object metadata
 */

const SF_LOGIN_URL = process.env.SF_LOGIN_URL || "https://login.salesforce.com";
const SF_API_VERSION = process.env.SF_API_VERSION || "v60.0";

let cachedToken = null; // { access_token, instance_url, fetched_at }

function requireEnv() {
  const missing = [];
  for (const k of ["SF_CLIENT_ID", "SF_CLIENT_SECRET", "SF_USERNAME", "SF_PASSWORD", "SF_SECURITY_TOKEN"]) {
    if (!process.env[k]) missing.push(k);
  }
  if (missing.length) {
    const err = new Error(`Salesforce not configured. Missing env: ${missing.join(", ")}`);
    err.code = "SF_NOT_CONFIGURED";
    throw err;
  }
}

async function authenticate() {
  requireEnv();
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: process.env.SF_CLIENT_ID,
    client_secret: process.env.SF_CLIENT_SECRET,
    username: process.env.SF_USERNAME,
    password: `${process.env.SF_PASSWORD}${process.env.SF_SECURITY_TOKEN}`,
  });

  const res = await fetch(`${SF_LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Salesforce auth ${res.status}: ${text.slice(0, 400)}`);
  }

  const json = await res.json();
  cachedToken = {
    access_token: json.access_token,
    instance_url: json.instance_url,
    fetched_at: Date.now(),
  };
  return cachedToken;
}

async function getToken() {
  if (!cachedToken) await authenticate();
  return cachedToken;
}

async function sfFetch(path, opts = {}, retry = true) {
  const tok = await getToken();
  const url = path.startsWith("http") ? path : `${tok.instance_url}${path}`;

  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${tok.access_token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

  if (res.status === 401 && retry) {
    cachedToken = null;
    return sfFetch(path, opts, false);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SF ${opts.method || "GET"} ${path} ${res.status}: ${text.slice(0, 500)}`);
  }

  // PATCH returns 204 No Content
  if (res.status === 204) return { success: true };

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

// ─── Public API ────────────────────────────────────────────────────────────

async function query(soql) {
  const q = encodeURIComponent(soql);
  return sfFetch(`/services/data/${SF_API_VERSION}/query?q=${q}`);
}

async function describe(object) {
  return sfFetch(`/services/data/${SF_API_VERSION}/sobjects/${object}/describe`);
}

async function getAccount(id, fields = ["Id", "Name", "Website", "Industry", "Phone"]) {
  const fieldStr = fields.join(",");
  return sfFetch(`/services/data/${SF_API_VERSION}/sobjects/Account/${id}?fields=${fieldStr}`);
}

async function queryAccounts(whereClause, fields = ["Id", "Name", "Website", "Industry"], limit = 50) {
  const soql = `SELECT ${fields.join(",")} FROM Account WHERE ${whereClause} LIMIT ${limit}`;
  return query(soql);
}

async function updateAccount(id, fields) {
  return sfFetch(`/services/data/${SF_API_VERSION}/sobjects/Account/${id}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

async function createContact(payload) {
  return sfFetch(`/services/data/${SF_API_VERSION}/sobjects/Contact`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Upsert a Contact by Email (uses External ID via composite query).
 * If a Contact with this Email already exists under the same AccountId, we update it;
 * otherwise we insert. Email must be present on the payload.
 */
async function upsertContactByEmail(payload) {
  if (!payload.Email) throw new Error("upsertContactByEmail requires Email");
  const accountFilter = payload.AccountId ? ` AND AccountId = '${payload.AccountId}'` : "";
  const existing = await query(
    `SELECT Id FROM Contact WHERE Email = '${payload.Email.replace(/'/g, "\\'")}'${accountFilter} LIMIT 1`
  );

  if (existing.totalSize > 0) {
    const id = existing.records[0].Id;
    await sfFetch(`/services/data/${SF_API_VERSION}/sobjects/Contact/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return { id, created: false };
  }

  const created = await createContact(payload);
  return { id: created.id, created: true };
}

async function createTask(payload) {
  return sfFetch(`/services/data/${SF_API_VERSION}/sobjects/Task`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function isConfigured() {
  return !!(
    process.env.SF_CLIENT_ID &&
    process.env.SF_CLIENT_SECRET &&
    process.env.SF_USERNAME &&
    process.env.SF_PASSWORD &&
    process.env.SF_SECURITY_TOKEN
  );
}

module.exports = {
  query,
  describe,
  getAccount,
  queryAccounts,
  updateAccount,
  createContact,
  upsertContactByEmail,
  createTask,
  isConfigured,
};
