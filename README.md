# Poolside it for me

Poolside it for me is a Chrome/Chromium Manifest V3 extension that opens a side-panel chat for inspecting, explaining, and operating the active browser tab.

The current prototype is extension-only. Runtime code lives in `extension/`, while UI pages are built from Svelte 5 sources in `src/pages/`. Chrome should load the generated `dist/chrome/` directory.

## Development Workflow

Install dependencies:

```sh
npm install
```

Build the unpacked extension:

```sh
npm run build
```

1. Open Chrome or another Chromium-based browser.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked** and select this repository's `dist/chrome/` directory.
5. Open the Poolside it for me side panel.
6. Save an OpenAI API key in **Advanced** if model-backed tasks are needed.
7. Use **Playground** for safe local testing.

Watch and rebuild during development:

```sh
npm run dev
```

Run all required checks before handoff:

```sh
npm run verify
```

`npm run verify` builds `dist/chrome/`, runs `svelte-check`, and syntax-checks the built service worker and content observer.

Node 24 or Node 22.12+ is the supported toolchain target for the current Svelte/Vite dependencies. This repo was also verified locally on Node 23.11.

## Frontend Stack

- Svelte 5 with runes.
- Vite 8 multi-page build.
- Tailwind CSS v4 with CSS-first tokens.
- Bits UI primitives and local shadcn-svelte-style components.
- `@lucide/svelte` icons.

The migration plan and implementation notes are in `docs/svelte-extension-migration-plan.md`.

## Architecture

- `src/pages/sidepanel/`: Svelte side-panel chat UI.
- `src/pages/trace/`: Svelte run-details page.
- `src/pages/playground/`: Svelte local fixture pages.
- `src/lib/`: shared UI components, Chrome helpers, trace formatting, and Tailwind CSS tokens.
- `components.json`: shadcn-svelte configuration for local UI component generation.
- `extension/service-worker.js`: MV3 background coordinator, model calls, agent loop, validation, confirmations, trace persistence, and playground opening.
- `extension/content/observer.js`: content-script observer and deterministic executor.
- `extension/shared/*`: protocol, storage, trace, and trace export helpers.
- `extension/model/*`: OpenAI client and agent decision logic.
- `scripts/build-extension.mjs`: copies runtime files and builds Svelte pages into `dist/chrome/`.
- `.github/workflows/verify.yml`: CI workflow for `npm ci` and `npm run verify`.
- `dist/chrome/`: generated unpacked extension output.

## Safety Model

- Do not execute model-generated JavaScript, CSS, selectors, or arbitrary code in pages.
- Use only element IDs from the latest page snapshot.
- Treat sending, submitting, deleting, purchasing, uploading, account changes, and similar external side effects as confirmation-required.
- Keep the API key in extension local storage and service-worker requests only.
