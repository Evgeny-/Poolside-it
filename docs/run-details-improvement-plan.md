# Run Details Improvement Plan

Date: 2026-05-11

## Goal

Redesign the Run Details page so it explains the browser-agent loop instead of exposing the raw trace shape as the primary UI. The page should remain useful for debugging, but the default view should make it obvious that each model decision is based on the most recent page observation captured by the extension orchestrator.

## Current Problems

- The timeline renders `observe` and `model_action` as peer steps. This makes it look like the model repeatedly requested `observe_page`, even though observation is an orchestrator-controlled pre-decision step.
- The left step navigation can stretch oddly when there are only a few steps because the sidebar uses a grid container with available vertical space.
- The summary and step metadata use large key/value cards. Long values such as page titles, URLs, instructions, and summaries wrap in narrow cells and create excessive vertical height.
- Every step exposes many equally weighted fields: tool, element, summary, risk, validation, preview, confirmation, execution, frame, model request, raw model text, and raw JSON. Important state is mixed with debug-only state.
- Observation details are too prominent for normal reading. Visible text and actionable elements are important, but they should be contextual evidence for a decision, not a full timeline stop every time.
- Raw JSON is available on every card, which is valuable for debugging but visually dominates the page.

## Target Mental Model

Render the trace as decision cycles:

```text
Observe current page -> Ask model for one action -> Validate -> Preview/confirm -> Execute -> Wait -> next cycle
```

In the stored trace this appears as alternating steps:

```text
observe(1), model_action(2), observe(3), model_action(4), ...
```

In the Run Details UI it should read as:

```text
Cycle 1: observed YouTube home, then filled search input
Cycle 2: observed search input state, then submitted search
Cycle 3: observed results page, then scrolled
```

Standalone observation steps should still be supported for manual `Observe page` traces or recovery cases, but normal agent runs should be action-centric.

## Proposed Information Architecture

### Header

Keep:

- Page title: `Run Details`
- Status pill: completed, running, failed, stopped
- Compact metadata line: task id, model, step count, duration
- Copy compact JSON and copy full JSON actions

Change:

- Move the long task instruction out of the key/value grid into a readable instruction block below the header.
- Replace the large summary card grid with a compact run overview row.

Suggested top layout:

```text
Run Details                  [completed] [Copy JSON] [Copy full JSON]
task_... | gpt-5.4 | 16 raw steps | 8 cycles | 42s

Instruction
Find an English Minecraft video and prepare a comment without sending it.
```

### Left Navigation

Replace raw step navigation with cycle navigation by default.

Each nav item should show:

- Cycle number
- Primary action icon or tool label
- Short action summary
- Small status marker: ok, blocked, failed, confirmation, recovery

Example:

```text
1 Fill search         ok
2 Submit search       confirmed
3 Scroll results      ok
4 Open video          ok
5 Draft comment       ok
6 Reply to user       done
```

Fix the layout:

- Use `flex flex-col` or block layout for the sidebar instead of `grid`.
- Set nav rows to intrinsic height.
- Keep sticky behavior on desktop only.
- Add `align-self: start` to the sidebar.
- Avoid `rounded-full` nav rows for long text; use `rounded-md` with stable row height and `line-clamp-2` or truncation.

### Main Timeline

Use one card per decision cycle instead of one card per raw trace step.

Each cycle card should contain:

- A compact header with cycle number, tool/action, execution status, timestamp.
- One-line natural-language summary.
- A compact status strip for important machine state.
- A collapsed or secondary "Observed context" section.
- A collapsed "Debug" section with model request, raw model text, raw step JSON, and full observation JSON.

Suggested cycle card structure:

```text
Cycle 2 - Submit search                         confirmed | ok | 16:47:37
Sent the YouTube search form for "Minecraft".

Context: YouTube home, 64 elements, 39 visible text snippets, 3 frames
Target: Search input (el_9), top frame

[Observed context]
[Validation and confirmation]
[Model request]
[Raw JSON]
```

## Grouping Rules

Add a small trace-view model helper, probably in `src/lib/trace/format.ts` or a new `src/lib/trace/cycles.ts`.

Algorithm:

- Iterate through `trace.steps` in order.
- When a step is `observe`, hold it as `pendingObservation`.
- When a step is `model_action`, create a cycle using the latest `pendingObservation` plus the model action.
- Clear `pendingObservation` after pairing it with the action.
- If another `observe` appears before an action, keep the latest observation and mark the prior one as standalone or recovery context.
- If a `model_action` appears without a pending observation, create a cycle with no observation and mark context as missing.
- Attach nearby `recovery` steps to the cycle that caused them when possible; otherwise render them as standalone recovery cards.
- Preserve raw step numbers inside each cycle so debug views can still reference the stored trace exactly.

Data shape:

```ts
type TraceCycle = {
  cycleNumber: number;
  observationStep?: any;
  actionStep?: any;
  recoverySteps: any[];
  rawStepNumbers: number[];
  status: "ok" | "blocked" | "failed" | "confirmed" | "recovery" | "done";
};
```

## Metadata Display

Replace `KeyValueGrid` as the default metadata renderer for long text-heavy values.

Use three patterns:

- `StatusStrip`: short badges for tool, risk, validation, confirmation, execution, frame.
- `PropertyList`: two-column label/value rows for values that may be long. Labels stay narrow; values get the full remaining width.
- `MetricRow`: compact numeric pills for frames, elements, text snippets, tokens, duration.

Avoid putting long URL/title/instruction values into equal-width cards.

### Primary Fields

Show these by default on every action cycle:

- Tool/action summary
- Execution status
- Confirmation status only when required or overridden
- Target element summary when present
- Page title or URL from the paired observation
- Observation counts: elements, text snippets, frames

Collapse these by default:

- Risk category unless non-safe or unknown
- Full validation object when validation is ok
- Preview details when preview is ok
- Frame details unless the target is inside an iframe or frame execution failed
- Raw model request
- Raw model text
- Raw step JSON

Always surface these when abnormal:

- Validation failure
- Execution failure
- Confirmation required/rejected
- Recovery step
- Missing or inaccessible frames
- Model parse/decision errors

## Observation UI

Observation should become evidence inside a cycle.

Default collapsed summary:

```text
Observed "Minecraft - YouTube" at 16:47:37
49 elements | 22 text snippets | 3 frames | scrollY 0
```

Expanded content:

- Page title and URL as full-width rows.
- Viewport and scroll position.
- Visible text preview with a small initial limit.
- Actionable elements preview with search/filter by text or element id.
- Frames and embedded frames only when there are multiple frames, inaccessible frames, or iframe targets.

Do not show all observation data as a separate full card unless the trace is a manual observation trace.

## Debug Mode

Add a page-level `Debug` toggle.

Default mode:

- Action-centric cycles.
- Compact metadata.
- Collapsed observed context.
- No raw JSON cards visible.

Debug mode:

- Show raw trace step numbers.
- Show model request context and raw model text.
- Show raw step JSON.
- Allow switching between `Cycles` and `Raw steps`.

This preserves the current debugging power while making the normal page readable.

## Visual Design Direction

- Reduce border-heavy nested cards. Use one card per cycle, then separators and compact rows inside it.
- Use `rounded-md` or `rounded-lg` for dense debug UI; reserve larger radii for the outer page shell if needed.
- Use compact badges with Lucide icons for action types:
  - `MousePointerClick` for click
  - `TextCursorInput` for fill/clear
  - `Send` or `CornerDownLeft` for submit/Enter
  - `MouseWheel` or `ArrowDown` for scroll
  - `MessageSquareText` for respond_to_user
  - `AlertTriangle` for recovery/failure
- Keep font sizes small and stable: 12px metadata, 13-14px body, 15-16px card headers.
- Use `overflow-wrap: anywhere` for URLs and element ids.
- Use line clamp for nav labels and card summaries where full text is available in an expanded section.
- Keep page width slightly wider than today, or give the main content more width by reducing the sidebar to about 240px.

## Component Plan

Likely new or changed files:

- `src/lib/trace/cycles.ts`
  - Build grouped cycle data from raw trace steps.
  - Derive cycle status, title, summary, target element, and observation metrics.
- `src/pages/trace/TraceApp.svelte`
  - Render cycle navigation by default.
  - Add debug toggle and optional raw step mode.
  - Replace summary key/value grid with compact overview.
- `src/pages/trace/TraceCycleCard.svelte`
  - New primary card for one observation/action cycle.
- `src/pages/trace/ObservationContext.svelte`
  - Compact observed context section used inside cycle cards.
- `src/pages/trace/ActionStatusStrip.svelte`
  - Tool, validation, confirmation, execution, risk badges.
- `src/pages/trace/PropertyList.svelte`
  - Better long-value display than equal-width key/value cards.
- `src/pages/trace/StepCard.svelte`
  - Keep for raw debug mode or refactor into cycle internals.
- `src/pages/trace/KeyValueGrid.svelte`
  - Keep for numeric/short metadata only, or replace with `MetricRow`.

## Implementation Slices

### Slice 1: Layout and Navigation Fix

- Change sidebar layout from grid to flex/block.
- Stop nav items from stretching.
- Reduce sidebar width to 240-260px.
- Improve nav item text wrapping/truncation.
- Keep raw step cards for now.

Validation:

- Trace with 2 steps does not produce tall empty nav rows.
- Trace with 16+ steps remains scrollable.
- Mobile still stacks sidebar above content.

### Slice 2: Compact Metadata

- Add `PropertyList` and/or `StatusStrip`.
- Replace large `KeyValueGrid` usage for long fields in summary, observation, and action cards.
- Move raw JSON behind a page-level debug toggle.

Validation:

- Long page titles and URLs do not balloon card height.
- Instruction is readable and not squeezed into a narrow cell.
- Normal timeline can be scanned without opening details.

### Slice 3: Cycle Grouping

- Implement trace-to-cycle grouping helper.
- Render cycle cards by default.
- Keep raw step mode available in debug mode.
- Pair each model action with the observation that was used to build its model request.

Validation:

- The Minecraft trace reads as roughly 8 cycles, not 16 peer steps.
- `respond_to_user` appears as the final decision based on the previous observation.
- Manual observe traces still render cleanly.

### Slice 4: Observation Context

- Move observation details inside cycle cards.
- Show compact observation counts by default.
- Expand visible text/actionable elements only on demand.
- Highlight target element within the observed elements list if present.

Validation:

- A user can answer "what did the model see before this action?" without opening raw JSON.
- A developer can still inspect full visible text and actionable elements.

### Slice 5: Debug Mode

- Add page-level debug toggle.
- In debug mode, expose raw step numbers, model request context, raw model text, and raw JSON.
- Add raw step timeline fallback for exact trace debugging.

Validation:

- Existing debugging information is not lost.
- Default view no longer shows raw JSON on every step.

## Acceptance Criteria

- The page no longer implies that the model requested `observe_page`.
- Normal agent runs are rendered as action-centric cycles.
- Sidebar items have stable, compact height for both short and long traces.
- Long titles, URLs, instructions, and summaries do not create narrow, very tall metadata tiles.
- Important abnormal states are visible without expanding debug sections.
- Full raw trace data remains accessible.
- The design works at desktop width and at the extension-friendly narrow/mobile breakpoint.
- `npm run verify` passes after implementation.

## Open Questions

- Should cycle numbering replace raw step numbering everywhere, or should the UI show both `Cycle 4` and `raw steps 7-8`?
- Should debug mode be persisted in local storage, or reset on each Run Details page load?
- Should the side panel trace preview also use the same cycle grouping, or only the standalone Run Details page?
- Should observations after non-mutating actions such as `read_page_text` be grouped differently?
