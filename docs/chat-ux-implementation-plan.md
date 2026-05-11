# Chat UX Implementation Plan

## Goals

- [x] Make the side panel feel like a chat application, not a trace viewer.
- [x] Show live one-line agent progress while the agent works.
- [x] Let the assistant answer with normal text messages.
- [x] Add persistent chat sessions with a new-chat flow and resumable context.
- [x] Move debug/history details out of the primary path.
- [x] Expose model and confirmation mode controls directly in chat.
- [x] Improve composer ergonomics: Enter sends, Shift+Enter inserts a newline, sent text clears.
- [x] Keep the deterministic browser-control layer and JSON trace support.

## Implementation Slices

- [x] Add conversation/session storage and migration-safe defaults.
- [x] Add protocol messages for new chat, chat switching, and live task events.
- [x] Extend the model schema with `respond_to_user`.
- [x] Include recent chat/session context in model requests.
- [x] Persist user, assistant, and compact tool-progress messages in conversations.
- [x] Emit live progress events from the service worker during agent runs.
- [x] Redesign the side panel Chat tab around sessions, messages, composer, model, and confirmation controls.
- [x] Move raw trace/history views into an Advanced tab.
- [x] Add inline confirmation cards in chat.
- [x] Update defaults so `smart_confirmation` is the default and mode labels are human-readable.
- [x] Source-review changed files without running validation/tests.

## Notes

- Sessions are scoped to the active tab workflow, but may follow navigations within that same tab.
- Local storage is capped to keep the MVP lightweight.
- Full traces remain available for debugging/export.

## Follow-Up Trace UX

- [x] Add a rendered run-details page for task traces.
- [x] Link chat messages to the rendered run-details page.
- [x] Show model request context, tool choices, validation, confirmation, execution, observations, and raw JSON in the trace viewer.
- [x] Render `respond_to_user.text` as the visible assistant chat answer.
- [x] Align the agent prompt and validation so substantive replies live in `respond_to_user.text`.
- [x] Reduce duplicate Run details links to one entry point per user run.
- [x] Add step navigation to the rendered run-details page.

## Follow-Up Chat Polish

- [x] Move the session selector to a full-width chat control row.
- [x] Move New Chat beside the session selector as a compact icon button.
- [x] Move model and confirmation mode selectors into the composer row.
- [x] Simplify agent step messages visually with compact progress styling.
- [x] Add an explicit website-access recovery card for normal `http`/`https` pages outside the playground.
- [x] Keep normal link actions as clicks, then wait for tab navigation/load before the next observe.
- [x] Reinject the observer content script if an action loses its message receiver around navigation.

## Follow-Up Exploration Quality

- [x] Include observed page summaries in model context.
- [x] Include unvisited same-site links in model context.
- [x] Instruct the model to keep exploring unvisited same-site links before answering whole-site/every-page requests.
- [x] Instruct the model to use `respond_to_user` with the actual answer instead of `finish` with a meta-summary.
- [x] Increase answer budget for longer site explanations.

## Follow-Up Recovery

- [x] Repair model responses that contain a valid JSON object plus trailing text.
- [x] Record recoverable model, validation, observation, and tool errors as trace steps.
- [x] Re-observe and continue the agent loop after recoverable errors instead of failing immediately.
- [x] Include recovery steps in model context and the rendered trace viewer.
- [x] Do not request confirmation for text-only `respond_to_user` responses, even when the model labels risk as unknown.
- [x] Make the approval card compact while keeping detailed policy data in traces.
