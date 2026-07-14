# Personal CRM MCP

This stdio MCP server gives Hermes structured access to every currently implemented Personal CRM API module without browser automation.

## Tools

- `personal_crm_workspace_overview`: compact read-only state across the workspace.
- `personal_crm_capabilities`: complete allowlisted operation catalog.
- `personal_crm_call`: reads and writes tasks, calendar events, ideas, finance, goals, movies, music, memories, preferences, and backups.

## Build

```powershell
npm install
npm run build:mcp
```

## Hermes configuration

Add this server through `hermes mcp add` or your Hermes `config.yaml`:

```yaml
mcp_servers:
  personal_crm:
    command: node
    args:
      - C:/Users/Bryan Rivs/Documents/Personal CRM/mcp/personal-crm-mcp/dist/index.js
    env:
      PERSONAL_CRM_URL: https://life.rivsconsole.shop
      PERSONAL_CRM_EMAIL: your-workspace-email
      PERSONAL_CRM_PASSWORD: your-workspace-password
    tools:
      include:
        - personal_crm_workspace_overview
        - personal_crm_capabilities
        - personal_crm_call
      resources: false
      prompts: false
```

The password remains in Hermes' local configuration and is never returned as tool output. Use Hermes' normal configuration permissions to protect that file.
