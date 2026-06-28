# NST SDR Intelligence Agent v2

A comprehensive sales intelligence engine for National Secure Transport. Researches prospects, generates Salesforce-ready data, and creates hyper-personalized outreach — all powered by [Perplexity Sonar API](https://docs.perplexity.ai/docs/sonar/quickstart).

## What's New in v2

- **Salesforce-native output** — research results map directly to Account, Contact, and Opportunity fields
- **3 endpoints** instead of 1 — full research, call prep, and quick enrichment
- **Real business intelligence baked in** — win rates by vertical, lead source performance, competitive positioning, and rep assignment logic
- **Call scripts** — cold call openers, qualifying questions, and objection handlers
- **Vertical-aware outreach** — different tone and angle for FIs, MSBs, and cash-intensive retail

## Quick Start

```bash
# 1. Clone
git clone https://github.com/ari926/nst-sdr-agent.git
cd nst-sdr-agent

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# Edit .env with your Perplexity API key

# 4. Run
npm start
```

## Endpoints

### `POST /research` — Full Prospect Research (Primary)

The main endpoint. Takes a company + contact and returns:
- **Salesforce Account fields** — Industry, Territory, Market Size, Description (ready to create/update a record)
- **Salesforce Contact fields** — Name, Title, Email, Background
- **Salesforce Opportunity fields** — Suggested opp name, stage, type, next step
- **Intelligence** — Vertical fit score, estimated products, pain signals, competitive angle, recommended rep
- **Email variants** — 2-3 personalized drafts under 150 words each
- **Call script** — Cold call opener, qualifying questions, objection handlers

**Required fields:**

| Field | Type | Description |
|-------|------|-------------|
| `company_name` | string | Company name |
| `contact_full_name` | string | Contact's full name |
| `contact_title` | string | Contact's job title |

**Optional fields:**

| Field | Type | Description |
|-------|------|-------------|
| `company_domain` | string | Company website domain |
| `contact_email` | string | Contact's email |
| `contact_linkedin_url` | string | Contact's LinkedIn URL |
| `company_linkedin_url` | string | Company LinkedIn page |
| `industry_hint` | string | e.g., "bank", "MSB", "check casher", "retail" |
| `lead_source` | string | How this lead was sourced |
| `existing_sf_notes` | string | Any existing CRM notes to include |
| `sequence_goal` | string | "net_new", "re-engage", "expansion" |

**Example:**

```bash
curl -X POST http://localhost:3000/research \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "Curaleaf Holdings",
    "company_domain": "curaleaf.com",
    "contact_full_name": "Matt Darin",
    "contact_title": "CEO",
    "industry_hint": "multi-state operator, cash-intensive retail",
    "lead_source": "Cold Email"
  }'
```

### `POST /call-prep` — Pre-Meeting Briefing

For preparing before a call or meeting with an existing prospect.

**Required:** `company_name`, `contact_full_name`

**Optional:** `company_domain`, `contact_title`, `opportunity_stage`, `last_activity`, `crm_notes`, `products_discussed`

```bash
curl -X POST http://localhost:3000/call-prep \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "Valley National Bank",
    "contact_full_name": "Tom Iadanza",
    "contact_title": "EVP Commercial Banking",
    "opportunity_stage": "Pitch",
    "products_discussed": "FI Virtual Vault, FI Branch CIT"
  }'
```

### `POST /enrich` — Quick Account Enrichment

Fast, minimal enrichment — classify a company into NST verticals and recommend products. Good for bulk processing lead lists.

**Required:** `company_name`

**Optional:** `company_domain`, `state_hint`

```bash
curl -X POST http://localhost:3000/enrich \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "Western Union",
    "company_domain": "westernunion.com",
    "state_hint": "NJ"
  }'
```

### `GET /health`

Returns status, version, model, and available endpoints.

## Salesforce Integration

The `/research` endpoint output is designed to feed directly into Salesforce:

1. `result.sf_account` → Create or update an Account record
2. `result.sf_contact` → Create or update a Contact record
3. `result.sf_opportunity` → Create an Opportunity record
4. `result.intelligence` → Use for internal prioritization (not stored in SF)
5. `result.email_variants` → Load into email sequences or paste into Mixmax

## NST Verticals & Win Rates (Built Into the Agent)

| Vertical | Win Rate | Fit |
|----------|----------|-----|
| MSB Money Transmitter | 97% | HIGH |
| Cash-Intensive Retail | 65-85% | HIGH |
| FI with Specialty Banking | 73-100% | HIGH |
| Other Retail | 45% | MEDIUM |
| Gov/School/Healthcare | 6% | LOW — avoid |
| QSR | 13% | LOW — avoid |

## Deploy

### Render
1. Push to GitHub
2. Create Web Service on render.com
3. Connect repo, set Node environment
4. Add `PERPLEXITY_API_KEY` env var

### Railway
1. Push to GitHub
2. Create project on railway.app
3. Auto-detects Node.js
4. Add `PERPLEXITY_API_KEY` in Variables

### Fly.io
```bash
fly launch --name nst-sdr-agent
fly secrets set PERPLEXITY_API_KEY=pplx-your-key
fly deploy
```

## Self-Sufficient Salesforce Enrichment (v2.4)

The agent can pull Accounts directly from Salesforce, enrich them, and write back — no Perplexity Computer or human in the loop. Designed to be called from Salesforce Flow, scheduled cron jobs, or Zapier.

### Provider routing

- **Apollo.io** — used if `APOLLO_API_KEY` is set. Gives verified emails, employee counts, revenue, phone (company main), LinkedIn, address.
- **Sonar (Perplexity)** — automatic fallback. Discovers contacts via live web research and returns the same shape. No additional vendor cost beyond your existing `PERPLEXITY_API_KEY`.

Industry routing is automatic via `lib/router.js`:
- Cannabis-like industries (Dispensary, Cultivator, Processor, MRB) → **Talaria** brand voice
- Banks, MSBs, cash-intensive retail, QSR, C-Store, etc. → **NST** brand voice (default)

### `POST /sf-enrich-account` — Single Account

Pulls one Account from SF, enriches it, optionally writes back.

```json
{
  "account_id": "001xx0000ABCDE",
  "write": true,
  "include_contacts": true,
  "target_roles": ["CFO", "VP Finance", "Director of Operations"]
}
```

**Write behavior** (only when `write: true`):
- Account fields are only updated where SF is currently blank (Website, Phone, Billing*, NumberOfEmployees, Description). Industry is **never** touched — that's off-limits per Talaria policy.
- Top 3 discovered contacts upsert by Email (within AccountId scope) or insert if no email.
- Every write appends an audit breadcrumb to `Description`: `AUDIT YYYY-MM-DD [nst-sdr-agent] {provider} enrichment — fields populated: ...`

### `POST /sf-bulk-enrich` — Many Accounts

Matches Accounts by SOQL where clause and fans out to single-account enrichment.

```json
{
  "filter": "Industry = 'Bank' AND Website = null",
  "limit": 50,
  "write": false,
  "include_contacts": true
}
```

Returns a per-account summary plus aggregate counts. Sequential processing keeps SF API limits sane; `limit` is capped at 200 per call.

### `GET /sf-enrich-status` — Config Check

```json
{
  "salesforce_configured": true,
  "apollo_configured": false,
  "sonar_available": true,
  "default_provider": "sonar"
}
```

### Salesforce Connected App setup

The agent uses OAuth 2.0 Username-Password flow (simplest for headless integrations).

1. **Salesforce → Setup → App Manager → New Connected App**
2. Enable OAuth Settings, set Callback URL to `https://login.salesforce.com/services/oauth2/success` (placeholder; not used in this flow)
3. Selected OAuth Scopes: **Full access (full)** + **Perform requests at any time (refresh_token, offline_access)**
4. Save. Wait 2-10 minutes for the app to propagate, then copy **Consumer Key** → `SF_CLIENT_ID` and **Consumer Secret** → `SF_CLIENT_SECRET`
5. Create or pick an **integration user** (Salesforce license, API Only profile recommended)
6. As that user: **Personal Settings → Reset My Security Token** → use the token as `SF_SECURITY_TOKEN`
7. Set `SF_USERNAME` and `SF_PASSWORD` to that user's login credentials

For sandboxes, set `SF_LOGIN_URL=https://test.salesforce.com`.

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `PERPLEXITY_API_KEY` | *(required)* | Perplexity API key |
| `PORT` | `3000` | Server port |
| `SONAR_MODEL` | `sonar-pro` | Model (`sonar` or `sonar-pro`) |
| `ROAM_WEBHOOK_URL` | *(blank)* | Optional Roam webhook for SDR Draft notifications |
| `SF_CLIENT_ID` | *(required for SF)* | Connected App consumer key |
| `SF_CLIENT_SECRET` | *(required for SF)* | Connected App consumer secret |
| `SF_USERNAME` | *(required for SF)* | Integration user login |
| `SF_PASSWORD` | *(required for SF)* | Integration user password |
| `SF_SECURITY_TOKEN` | *(required for SF)* | User security token |
| `SF_LOGIN_URL` | `https://login.salesforce.com` | Use `https://test.salesforce.com` for sandbox |
| `SF_API_VERSION` | `v60.0` | SF REST API version |
| `APOLLO_API_KEY` | *(blank → Sonar fallback)* | Optional Apollo.io Basic key |

## License

MIT
