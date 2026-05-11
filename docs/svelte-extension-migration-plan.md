# Svelte Extension Migration Plan

## Decision

Move the extension UI to a modern Svelte 5 + Vite pipeline, while keeping the Poolside it for me runtime constraints explicit:

- Chrome loads a built unpacked extension from `dist/chrome/`, not source files.
- MV3 service worker and content script paths remain stable in the built output.
- UI pages move to Svelte 5 components using runes.
- Styling uses Tailwind CSS v4 with CSS-first tokens and the first-party Vite plugin.
- UI primitives use shadcn-svelte components backed by Bits UI, with `@lucide/svelte` for icons.
- Agent, storage, trace, and content-observer behavior must remain deterministic and auditable.

## Implementation Status

Implemented on 2026-05-11:

- `package.json`, Vite, Svelte, TypeScript, Tailwind CSS v4, and verification scripts.
- `scripts/build-extension.mjs` builds `dist/chrome/` by copying stable MV3 runtime files from `extension/` and compiling Svelte UI pages from `src/pages/`.
- `scripts/watch-extension.mjs` continuously rebuilds `dist/chrome/` during development.
- `components.json` configures shadcn-svelte for local UI component generation.
- `.github/workflows/verify.yml` runs `npm ci` and `npm run verify`.
- Side panel UI migrated to Svelte 5 in `src/pages/sidepanel/`.
- Run Details UI migrated to Svelte 5 in `src/pages/trace/`.
- Playground pages migrated to Svelte 5 in `src/pages/playground/`.
- Shared UI helpers, Chrome runtime helpers, trace formatters, and Tailwind CSS v4 tokens added under `src/lib/`.
- `npm run verify` builds the extension, runs `svelte-check`, and syntax-checks the built service worker and content observer.

Runtime files currently remain in `extension/` and are copied into `dist/chrome/`. This keeps service-worker and content-script behavior stable while the UI now runs on the new Svelte build rail.

Latest package versions checked on 2026-05-11:

- `svelte`: `5.55.5`
- `vite`: `8.0.12`
- `@sveltejs/vite-plugin-svelte`: `7.1.2`
- `tailwindcss`: `4.3.0`
- `@tailwindcss/vite`: `4.3.0`
- `bits-ui`: `2.18.1`
- `shadcn-svelte`: `1.2.7`
- `@lucide/svelte`: `1.14.0`

Node 24 or Node 22.12+ is the supported target for the current Svelte/Vite dependencies. The migration was verified locally on Node 23.11 as well.

## Why This Stack

Svelte 5 is a good fit for extension pages because it compiles component code and keeps runtime overhead low. Runes give us explicit state, derived values, and effects in `.svelte`, `.svelte.js`, and `.svelte.ts` files. Use `$state` and `$derived` for UI state; use `$effect` only for browser-side side effects such as `chrome.runtime` listeners, DOM integrations, and cleanup.

Vite gives us a fast build pipeline and watch mode, but the extension should be developed as build output, not as a normal remote dev-server app. The Chrome extension package must contain all executable code. In practice:

- `npm run dev` should rebuild `dist/chrome/` on file changes.
- Chrome should load `dist/chrome/` as the unpacked extension.
- We should avoid relying on Vite dev-server HMR inside the extension package unless we later adopt a dedicated extension dev framework and verify its MV3 behavior.

shadcn-svelte is the right UI layer because it is not a black-box component package. It writes component source into the repo, so agents and humans can inspect and adjust the code. Bits UI supplies the accessible headless primitives underneath. Tailwind v4 provides modern CSS tokens and fast incremental builds.

## Target Layout

Implemented shape:

```text
dist/
  chrome/
    manifest.json
    service-worker.js
    sidepanel.html
    trace.html
    content/
      observer.js
    playground/

src/
  pages/
    sidepanel.html
    trace.html
    sidepanel/
    trace/
    playground/
  lib/
    chrome/
    components/
      ui/
    stores/
    trace/
    utils.ts

scripts/
  build-extension.mjs
  watch-extension.mjs

extension/
  manifest.json
  service-worker.js
  content/
  model/
  shared/
```

The runtime folder move to TypeScript can still be staged later. The completed UI migration does not require moving service-worker/content files.

## Build Requirements

Scripts:

- `npm run dev`: watch source and continuously rebuild `dist/chrome/`.
- `npm run build`: produce a clean production-ready `dist/chrome/`.
- `npm run check`: run Svelte checks plus syntax checks for built service-worker/content files.
- `npm run verify`: run `build` and `check`; this is mandatory before handing off a feature.

Chrome development workflow:

1. Run `npm run dev`.
2. Open `chrome://extensions`.
3. Load unpacked from `dist/chrome/`.
4. After source changes, reload the extension if Chrome has not picked up the rebuilt files.

## Migration Phases

### Phase 1: Build Pipeline With Behavior Parity

Status: complete.

Goal: introduce `dist/chrome/` without rewriting runtime behavior.

- Add `package.json`, lockfile, Vite config, Svelte config, TypeScript configs, and `.gitignore` updates.
- Configure stable output names:
  - `service-worker.js`
  - `content/observer.js`
  - `sidepanel.html`
  - `trace.html`
  - `playground/*`
- Copy or generate `manifest.json` so its paths point at built files.
- Keep the current vanilla pages working from the built output.
- Update README and AGENTS instructions so agents load/build `dist/chrome/`.

Validation:

- `npm run verify`
- Load `dist/chrome/` as unpacked extension.
- Open side panel.
- Open playground.
- Observe a page.
- Open run details.

### Phase 2: Svelte UI Foundation

Status: complete.

Goal: establish the component system before rewriting large pages.

- Install Svelte 5, Vite, Tailwind CSS v4, shadcn-svelte, Bits UI, `@lucide/svelte`, `clsx`, and `tailwind-merge`.
- Initialize shadcn-svelte for a Vite project.
- Add design tokens in the Tailwind v4 CSS file.
- Add first UI primitives:
  - Button
  - Input
  - Textarea
  - Select / Native Select
  - Tabs
  - Badge
  - Tooltip
  - Scroll Area
  - Separator
  - Dialog / Alert Dialog
  - Sheet
  - Switch / Checkbox
  - Table
- Add shared wrappers for Chrome extension messaging and storage.

Rules:

- Prefer Svelte 5 runes over legacy `$:` patterns.
- Use `$derived` for computed data.
- Use `$effect` for external side effects and cleanup, not for synchronizing state that could be derived.
- Keep Chrome APIs behind small typed helpers.

### Phase 3: Migrate Run Details First

Status: complete.

Goal: replace the most painful hand-built DOM page first.

Create Svelte components:

- `TraceApp.svelte`
- `TraceSummary.svelte`
- `StepNav.svelte`
- `StepCard.svelte`
- `ObservationStep.svelte`
- `ModelActionStep.svelte`
- `RecoveryStep.svelte`
- `ExpandableList.svelte`
- `JsonDetails.svelte`

Behavior to preserve or improve:

- Full `snapshot.pageText` and `snapshot.elements` available without opening raw JSON.
- Compact-by-default sections with explicit expand controls.
- Copy compact JSON and copy full JSON.
- Human-readable rendering of validation, confirmation, execution, recovery, and model request context.

Validation:

- Existing trace data renders correctly.
- Large snapshots remain navigable.
- Copy buttons still work.
- No raw trace fields are lost.

### Phase 4: Migrate Side Panel

Status: complete.

Goal: move the main agent UX to Svelte without changing protocol semantics.

Create Svelte components:

- `SidePanelApp.svelte`
- `AppHeader.svelte`
- `TabStrip.svelte`
- `ChatPanel.svelte`
- `ChatLog.svelte`
- `ChatMessage.svelte`
- `Composer.svelte`
- `ConfirmationCard.svelte`
- `SiteAccessCard.svelte`
- `AdvancedPanel.svelte`
- `SettingsForm.svelte`
- `TaskHistory.svelte`
- `DebugSnapshot.svelte`

Move state into runes-based modules:

- `conversationStore.svelte.ts`
- `settingsStore.svelte.ts`
- `taskRunStore.svelte.ts`
- `traceStore.svelte.ts`
- `chromeRuntime.svelte.ts`

Rules:

- Message names remain centralized in `shared/protocol`.
- Side panel still talks to the service worker through `chrome.runtime.sendMessage`.
- Long-running task updates still come from service-worker UI task events.
- Confirmation UI must preserve deterministic override semantics.
- API key remains in `chrome.storage.local` and service-worker requests only.

Validation:

- Start/stop task.
- Observe page.
- Save settings.
- Switch conversations.
- Open run details.
- Grant optional host access recovery flow.
- Confirmation required actions still block until user action.

### Phase 5: Migrate Playground Interfaces

Status: complete.

Goal: bring the local test pages onto the same build rails while preserving their test value.

- Convert playground pages to Svelte or a small Svelte multi-page fixture app.
- Preserve stable URLs used by `chrome.runtime.getURL("playground/index.html")`.
- Keep observer loaded on playground pages.
- Keep pages simple enough to be reliable fixtures for manual agent tests.

Validation:

- Home page.
- Contact form.
- Fake compose.
- Dynamic controls.
- Ambiguous controls.

### Phase 6: TypeScript Runtime Migration

Status: not required for the completed UI migration.

Goal: modernize non-UI code after the UI build is stable.

- Convert shared modules to TypeScript first.
- Convert model/openai-client modules second.
- Convert service worker once shared contracts are typed.
- Convert content observer last, or keep it as plain JavaScript if bundling it introduces injection risk.

Rules:

- Do not weaken the safety model.
- Do not execute model-generated selectors, JavaScript, or CSS.
- Keep tool validation close to execution.
- Preserve trace shape compatibility or add explicit migration handling.

### Phase 7: Verification And CI

Status: complete.

Goal: make the build contract enforceable.

- Add `svelte-check`.
- Add lint/format once the source tree is stable.
- Add Playwright smoke tests for built extension pages if feasible.
- Add a CI job that runs `npm ci`, `npm run verify`, and any smoke tests.

Required handoff after every feature:

- `npm run verify` must pass.
- The changed feature must be tested from `dist/chrome/`, not from source files.
- If UI changed, manually reload the unpacked extension and verify the affected page.

## Open Questions

- Whether to use plain Vite MPA throughout or adopt an extension-specific framework later. The first migration should use plain Vite because it is easier to audit and keeps MV3 paths explicit.
- Whether to fully migrate the content observer to TypeScript. This should happen only after stable output and injection behavior are proven.
- Whether to add automatic Chrome extension reload during `npm run dev`. This is useful, but it should be a second step after reliable build output exists.

## References

- Svelte runes: https://svelte.dev/docs/svelte/what-are-runes
- Svelte `$state`: https://svelte.dev/docs/svelte/$state
- Svelte `$effect`: https://svelte.dev/docs/svelte/$effect
- Vite build watch: https://main.vite.dev/config/build-options.html#build-watch
- Vite public assets: https://vite.dev/config/shared-options.html#publicdir
- Chrome MV3 overview: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- Chrome MV3 background service worker: https://developer.chrome.com/docs/extensions/reference/manifest/background
- Tailwind CSS v4: https://tailwindcss.com/blog/tailwindcss-v4
- Tailwind CSS Vite installation: https://tailwindcss.com/docs/installation/using-vite
- shadcn-svelte: https://www.shadcn-svelte.com/docs
- shadcn-svelte Vite install: https://www.shadcn-svelte.com/docs/installation/vite
- Bits UI: https://bits-ui.com/docs/introduction
- `@lucide/svelte`: https://lucide.dev/guide/svelte
