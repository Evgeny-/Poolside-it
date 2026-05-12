# Poolside it for me

Poolside it for me is a Chrome/Chromium extension that opens an AI side-panel for the active browser tab. It can inspect visible page content, explain what it sees, and perform controlled browser actions such as clicking, filling fields, selecting options, pressing keys, and scrolling.

It can also work as a local MCP bridge, so MCP clients can drive the browser through the loaded extension.

## What It Includes

- Side-panel chat for browser tasks.
- Deterministic page observation and typed browser actions.
- Confirmation checks for risky actions such as submitting forms or making account changes.
- Local playground pages for safe testing.
- Run details with observations, model decisions, validation, confirmations, and execution results.
- Optional local MCP bridge for driving the extension from MCP clients.

## Requirements

- Node.js 22.12+ or 24+
- npm
- Chrome or another Chromium-based browser
- OpenRouter API key for model-backed tasks

## Run Locally

Install dependencies:

```sh
npm install
```

Build the unpacked extension:

```sh
npm run build
```

Load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the generated `dist/chrome/` directory.
5. Open the extension side panel.
6. Add your OpenRouter API key in **Advanced**.
7. Use **Playground** for safe first tests.

During development, rebuild automatically with:

```sh
npm run dev
```

Before sharing changes, run:

```sh
npm run verify
```

This builds the extension, runs `svelte-check`, and syntax-checks the built service worker, content observer, and MCP server.

## Use With MCP

Poolside it for me includes a local stdio MCP server. The MCP server starts a small localhost broker, and the Chrome extension connects to it from the side panel.

First, build and load the extension as described above. Keep the side panel open so the extension can connect to the bridge.

For MCP clients that support YAML-style configuration, add a server like this:

```yaml
mcp_servers:
  poolside-browser:
    command: node
    args:
      - /absolute/path/to/Poolside-it/mcp/server.mjs
```

For MCP clients that use JSON configuration, use the same command and args:

```json
{
  "mcpServers": {
    "poolside-browser": {
      "command": "node",
      "args": ["/absolute/path/to/Poolside-it/mcp/server.mjs"]
    }
  }
}
```

You can also start the bridge manually from this repository:

```sh
npm run mcp
```

By default, the broker listens on `127.0.0.1:8765`. Browser tools return a clear disconnected error until the extension side panel is open and connected.

## Project Layout

- `extension/`: Manifest V3 runtime files, service worker, content observer, shared protocol/storage/trace helpers, and model client.
- `src/pages/sidepanel/`: Svelte side-panel app.
- `src/pages/trace/`: Svelte run-details app.
- `src/pages/playground/`: Safe local test pages.
- `src/lib/`: shared UI components, styles, Chrome helpers, and trace formatting.
- `scripts/build-extension.mjs`: builds `dist/chrome/`.

`dist/chrome/` is generated output and is not edited directly.
