# AGENTS.md

## Project Overview

This repository contains a Chrome/Chromium Manifest V3 extension called **Poolside it for me**. The extension opens a side-panel chat where a user can ask an agent to inspect, explain, or operate the active browser tab.

The current MVP is intentionally extension-only:

- No local backend.
- Svelte 5 + Vite + Tailwind CSS v4 build pipeline for extension UI pages.
- shadcn-svelte-style local components backed by Bits UI primitives, with `@lucide/svelte` icons.
- OpenAI Responses API calls are made from the extension service worker.
- User settings, conversations, task history, snapshots, and traces are stored in `chrome.storage.local`.
- The user provides their own OpenAI API key in the side panel.
- Agent runs default to 50 steps and can be configured up to 1000 steps.

Chrome should load the generated `dist/chrome/` extension output rather than source files. The Svelte migration plan and implementation notes are tracked in `docs/svelte-extension-migration-plan.md`.

## Repository Layout

- `browser-agent-extension-plan.md`: product and architecture plan for the extension.
- `docs/chat-ux-implementation-plan.md`: completed implementation notes for chat UX, trace UX, exploration quality, and recovery behavior.
- `docs/svelte-extension-migration-plan.md`: plan for moving extension UI pages to Svelte 5, Vite, Tailwind CSS v4, and shadcn-svelte/Bits UI.
- `package.json`, `vite.config.mjs`, `svelte.config.js`, `tsconfig*.json`: Svelte/Vite build toolchain.
- `components.json`: shadcn-svelte configuration for local UI component generation.
- `.github/workflows/verify.yml`: CI workflow that runs `npm ci` and `npm run verify`.
- `scripts/build-extension.mjs`: creates `dist/chrome/` by copying the MV3 runtime files and building Svelte UI pages.
- `scripts/watch-extension.mjs`: watches source files and rebuilds `dist/chrome/` during development.
- `src/pages/sidepanel.*`, `src/pages/sidepanel/`: Svelte side-panel chat UI, settings, confirmation cards, site-access recovery, trace/history views.
- `src/pages/trace.*`, `src/pages/trace/`: Svelte run-details page for persisted task traces.
- `src/pages/playground/`: Svelte local extension pages used as safe manual test targets for navigation, forms, dynamic controls, and ambiguous elements.
- `src/lib/`: shared Svelte UI helpers, Chrome runtime wrappers, trace formatting helpers, and Tailwind CSS v4 tokens.
- `extension/manifest.json`: MV3 manifest copied into `dist/chrome/`.
- `extension/service-worker.js`: background/service-worker orchestration, panel message handling, agent loop, confirmation policy, observer injection, action execution, trace persistence, and playground opening.
- `extension/content/observer.js`: content-script observer and deterministic executor. It snapshots visible page text/actionable elements and executes typed actions against temporary element IDs.
- `extension/model/agent.js`: prompt, response JSON schema, snapshot compaction, conversation context, exploration state, and model decision parsing.
- `extension/model/openai-client.js`: direct OpenAI Responses API and model-list calls.
- `extension/shared/protocol.js`: shared message names, storage keys, defaults, built-in model list, and trace limits.
- `extension/shared/storage.js`: Chrome local-storage helpers for settings, conversations, history, traces, and latest debug state.
- `extension/shared/trace.js`: task trace IDs, trace step creation, tab serialization, and error serialization.
- `dist/chrome/`: generated unpacked extension output. Do not edit this directory directly.

## How To Run

Install dependencies once:

```sh
npm install
```

Build workflow:

```sh
npm run build
```

1. Open Chrome or another Chromium-based browser.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked** and select the repository's `dist/chrome/` directory.
5. Click the Poolside it for me extension icon to open the side panel.
6. In **Advanced**, save an OpenAI API key if model-backed tasks are needed.
7. Use the **Playground** button for safe local testing before trying normal websites.

For normal `http` or `https` websites, the side panel may need optional host access. Use the in-app website-access recovery card when Chrome blocks content-script injection.

During development:

1. Run `npm run dev` to rebuild `dist/chrome/` after source changes.
2. Reload the unpacked extension in Chrome when needed.
3. Run `npm run verify` before handing off any finished feature.
4. Test changed UI from the built extension output, not directly from source files.

## Architecture Notes

The service worker is the central coordinator. The side panel sends `MESSAGE_TYPES` from `extension/shared/protocol.js`; the service worker handles those messages, persists state through `extension/shared/storage.js`, and emits UI task events back to the side panel.

The agent loop in `extension/service-worker.js` follows this shape:

1. Resolve the active tab and conversation.
2. Request a structured `PageSnapshot` from `extension/content/observer.js`.
3. Append an observe step to the task trace.
4. Ask `chooseNextAction` in `extension/model/agent.js` for exactly one JSON decision.
5. Normalize and validate the tool call against the current snapshot.
6. Apply deterministic confirmation policy.
7. Execute safe typed actions through the content script, or return assistant text through `respond_to_user`.
8. Persist traces and compact chat progress throughout the run.

The model never receives raw full HTML by default. It receives compact visible text, visible actionable elements, prior trace actions, recent conversation messages, and same-site exploration hints.

The content script never receives the OpenAI API key. It only observes pages and executes typed browser actions such as `click_element`, `fill_element`, `clear_element`, `select_option`, `press_key`, and `scroll`.

Model input is capped to roughly 100,000 characters. The original user instruction is preserved, previous page observations keep URL/title/visit metadata without page text, previous actions are compact action summaries, and current page text is paginated through `pageSnapshot.visibleText`. If visible text is truncated, the model can call the read-only `read_page_text` tool with `nextCursor` to request another chunk.

Task traces keep compact model request previews and context-management metadata instead of storing every full model input. This matters for long runs now that the step limit can be much higher.

## Safety Model

Keep browser control deterministic and auditable:

- Do not execute model-generated JavaScript, CSS, selectors, or arbitrary code in pages.
- Use only element IDs from the latest `PageSnapshot`.
- Keep new tools typed and validate their arguments before execution.
- Treat sending, submitting, deleting, purchasing, uploading, account changes, and other external side effects as confirmation-required.
- Preserve the distinction between model-requested confirmation and deterministic confirmation overrides.
- `respond_to_user`, `finish`, and `abort` are non-executable tools and should not require confirmation.
- The API key must remain in extension local storage and service-worker requests only.

## Development Conventions

- Prefer Svelte 5 components for extension UI pages and keep Chrome loading `dist/chrome/`.
- Use Svelte 5 runes for new Svelte state: prefer `$state` for local mutable state and `$derived` for computed values. Use `$effect` only for external browser-side effects such as Chrome listeners, DOM integrations, and cleanup.
- Prefer shadcn-svelte components backed by Bits UI for reusable UI primitives, and use `@lucide/svelte` icons in controls where an icon exists.
- Keep Tailwind CSS v4 tokens and component styling in the Svelte UI source; do not introduce styling dependencies into the content script.
- Prefer small, explicit browser APIs and keep Chrome-specific calls behind narrow helpers when migrating UI.
- Keep shared constants in `extension/shared/protocol.js`.
- Keep persistence behavior in `extension/shared/storage.js`.
- Keep trace shape changes coordinated across `extension/service-worker.js`, `extension/shared/trace.js`, `src/pages/sidepanel/`, and `src/pages/trace/`.
- When adding model tools, update `AGENT_TOOLS`, the JSON schema, prompt/output contract, validation, execution, trace rendering, and any UI labels together.
- When changing observer snapshots, update both compaction in `extension/model/agent.js` and trace/debug rendering if humans need to inspect the new fields.
- Keep context management conservative: do not add previous page text back into model input, and prefer cursor-based read tools for large current-page content.
- Preserve ASCII-only source unless a file already uses non-ASCII or the change requires it.

## Validation

Required automated check before handoff:

```sh
npm run verify
```

Useful manual checks:

- Load `dist/chrome/` as an unpacked extension and confirm the side panel opens.
- Open the built-in playground from the side panel.
- Use **Advanced > Observe page** and confirm a snapshot appears.
- Run safe chat tasks against the playground pages:
  - explain the home page,
  - fill the contact form,
  - draft a fake email,
  - reveal dynamic controls,
  - inspect ambiguous controls.
- Check **Run details** for observation, model request, validation, confirmation, execution, recovery, raw JSON sections, and expandable full visible text/actionable elements.
- Test a normal website and verify the website-access recovery card appears when host permission is missing.

`npm run verify` builds the extension, runs `svelte-check`, and syntax-checks the built service worker and content observer. Browser globals such as `chrome`, `document`, and `window` are expected.

## Current State

The main chat UX, trace UX, site exploration behavior, recovery behavior, and Svelte UI migration have been implemented. The repository is still a prototype: it is optimized for developer/power-user testing, local storage, BYOK OpenAI usage, and the included playground before attempting complex sites such as Gmail.
