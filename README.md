# NST SDR Intelligence Agent

A minimal Node.js service that accepts SDR research requests and returns structured, web-grounded intelligence via [Perplexity Sonar API](https://docs.perplexity.ai/docs/sonar/quickstart).

Given a company + contact, the agent researches the target using live web search and returns:
- **Company snapshot** — what they do, who they serve, size, news, competitors
- **Contact dossier** — title, tenure, prior roles, likely priorities
- **High-signal triggers** — funding, hiring, leadership changes, expansion
- **Recommended angles** — NST value props mapped to those triggers
- **Email variants** — 2-3 ready-to-send drafts (80-150 words each)
- **Sources** — URLs used during research

## Quick Start

```bash
# 1. Clone
git clone https://github.com/ari926/nst-sdr-agent.git
cd nst-sdr-agent

# 2. Install dependencies
npm install

# 3. Add your Perplexity API key
cp .env.example .env
# Edit .env and paste your real key

# 4. Run
npm start
# → NST SDR Agent listening on http://0.0.0.0:3000
```

## API

### `POST /nst-sdr-agent`

**Required fields:**

| Field               | Type   | Description                     |
|---------------------|--------|---------------------------------|
| `company_name`      | string | e.g. "Acme Analytics"           |
| `company_domain`    | string | e.g. "acmeanalytics.com"        |
| `contact_full_name` | string | e.g. "Jane Doe"                 |
| `contact_title`     | string | e.g. "VP of Sales"              |

**Optional fields:**

| Field                   | Type   | Description                                  |
|-------------------------|--------|----------------------------------------------|
| `contact_linkedin_url`  | string | LinkedIn profile URL                         |
| `company_linkedin_url`  | string | Company LinkedIn page                        |
| `industry_hint`         | string | e.g. "B2B SaaS, mid-market, PLG"            |
| `current_sequence_goal` | string | e.g. "net_new", "re-engage", "expansion"     |
| `tone_preference`       | string | e.g. "concise", "consultative", "friendly"   |

**Example request:**

```bash
curl -X POST http://localhost:3000/nst-sdr-agent \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "Acme Analytics",
    "company_domain": "acmeanalytics.com",
    "contact_full_name": "Jane Doe",
    "contact_title": "VP of Sales",
    "industry_hint": "B2B SaaS, mid-market, PLG",
    "current_sequence_goal": "net_new",
    "tone_preference": "concise"
  }'
```

### `GET /health`

Returns `{ "status": "ok", "model": "sonar-pro", "timestamp": "..." }`

## Deploy

### Render

1. Push this repo to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Connect your repo
4. Set environment: **Node**, build command: `npm install`, start command: `npm start`
5. Add environment variable: `PERPLEXITY_API_KEY`

### Railway

1. Push to GitHub
2. Create a new project on [railway.app](https://railway.app)
3. Connect repo → Railway auto-detects Node.js
4. Add `PERPLEXITY_API_KEY` in Variables tab

### Fly.io

```bash
fly launch --name nst-sdr-agent
fly secrets set PERPLEXITY_API_KEY=pplx-your-key
fly deploy
```

## Configuration

| Env Variable         | Default      | Description                        |
|----------------------|--------------|------------------------------------|
| `PERPLEXITY_API_KEY` | *(required)* | Your Perplexity API key            |
| `PORT`               | `3000`       | Port the server listens on         |
| `SONAR_MODEL`        | `sonar-pro`  | Model to use (`sonar` or `sonar-pro`) |

## License

MIT
