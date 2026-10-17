# Research prospect triggers with Parallel Search MCP

Use [Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
in your MCP client to find prospect news and read the source pages before calling
`POST /research`. This is useful for the agent's trigger hunt: acquisitions,
expansion, leadership changes, carrier problems, and cash management events.
The MCP server offers free web search and page fetching without a Parallel
account or API key. Anonymous search uses Fast mode and has usage limits.

This is a manual research workflow. The NST server still uses Perplexity Sonar,
requires `PERPLEXITY_API_KEY`, and defaults to `sonar-pro`. It does not connect to
MCP itself. Complete the [Quick Start](../README.md#quick-start) before submitting
a research request.

## 1. Connect your research client

For VS Code with MCP-enabled chat, add this entry to `.vscode/mcp.json` in your
workspace. If the file already has a `servers` object, merge the `parallel-search`
entry into it, keeping your existing servers and settings.

```json
{
  "servers": {
    "parallel-search": {
      "type": "http",
      "url": "https://search.parallel.ai/mcp"
    }
  }
}
```

Run **MCP: List Servers**, select `parallel-search`, and start it. Confirm the
trust prompt if shown, then enable its `web_search` and `web_fetch` tools in chat.
See [VS Code's MCP setup](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
or [setup for other clients](https://docs.parallel.ai/integrations/mcp/search-mcp#installation).

## 2. Find and verify a trigger

Replace the bracketed details in this prompt and send it in your MCP client:

```text
Use Parallel's web_search to research [company name] ([company domain]).
Look for acquisitions, new locations, leadership changes, carrier problems,
or cash management events in the last six months. Prefer company announcements,
regulatory filings, and reliable reporting. Use web_fetch to read promising
source URLs. For each supported event, give the event date, publication date,
source URL, and a short supporting excerpt. Distinguish this company from
similarly named companies. If no event can be verified, say so explicitly.
```

Check that the client actually called `web_search` and `web_fetch`. Review the
pages and dates yourself; a search snippet alone is not a verified trigger.
Keep the source URL beside each claim. An inaccessible page or exhausted MCP
quota leaves that source unverified; do not fill the gap with an invented event.

## 3. Pass the source notes to NST research

Save the following template as `research-request.json` in the repository root.
Replace every bracketed value with your prospect details and verified notes.
For multiple events, include each event's date, URL, and supporting excerpt in
`existing_sf_notes`. Keep any existing CRM notes in that same string.

```json
{
  "company_name": "[company name]",
  "company_domain": "[company domain]",
  "contact_full_name": "[contact full name]",
  "contact_title": "[contact title]",
  "existing_sf_notes": "Event: [verified event and event date]. Published: [publication date]. Source: [URL]. Supporting excerpt: [excerpt]."
}
```

With the NST server running, submit it from a second terminal:

```bash
curl --fail-with-body -X POST http://localhost:3000/research \
  -H "Content-Type: application/json" \
  --data-binary @research-request.json
```

The server includes `existing_sf_notes` in Sonar's research prompt. These notes
provide context; they do not force a trigger or replace the agent's own search.
If your research found no verified event, record that and the URLs you reviewed
in the notes instead of using the event template.

Review `result.buying_trigger`, its `trigger_source_url`, and `result.sources`
before using any outreach. The research prompt instructs Sonar to set
`buying_trigger.found` to `false` and return an empty `email_variants` array when
it cannot verify a trigger. Check that the response follows that rule before
sending an email.
