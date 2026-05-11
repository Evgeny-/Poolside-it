# Fyr-Inspired Design Migration Plan

Date: 2026-05-11

Source analyzed: `https://github.com/poolsideai/fyr`, cloned locally to `/tmp/poolsideai-fyr` at commit `daa41f5`.

## Goal

Move Poolside it for me toward the visual language used in Fyr/Shimmer while keeping the product extension-first, Svelte 5, and Chrome-side-panel friendly. The target is not a one-to-one port of Fyr's React components. The target is to inherit the same working-app feel: compact, calm, tactile, slightly glossy, with a strong Poolside accent system and fewer boxed "settings page" surfaces.

## Fyr Design Summary

Fyr is a dense workspace shell, not a marketing UI. The dominant surfaces are full-height panels, border-separated regions, compact rows, small type, low-contrast backgrounds, and highly intentional controls.

Key traits found in `/tmp/poolsideai-fyr/src/app/globals.css`, `/tmp/poolsideai-fyr/src/components/ui`, and `/tmp/poolsideai-fyr/src/components/workspace`:

- **Typography:** Geist Sans for UI text and JetBrains Mono for technical/context text. The scale is deliberately small: `10px`, `11px`, `12px`, `13px`, `14px`, `15px`, `17px`, `20px`, `22px`, `28px`.
- **Surfaces:** light mode uses near-white warm neutrals: `#fcfcfa` background and `#fcfbf8` surface. Dark mode uses `#0a0a0a` background and `#171717` surface.
- **Accent system:** one active Poolside accent palette drives links, focus, user bubbles, active rows, switches, and primary buttons. The default is Royal (`#4137ff`) with optional Grape, Strawberry, Tangerine, Lime, Bondi, and Graphite themes.
- **Controls:** buttons are pill-shaped, gradient-backed, and inset-shadowed. Inputs are modest `rounded-lg` boxes with subtle borders and a 3px translucent focus ring.
- **Layout:** the app reads as a workspace: sidebar, header, chat, resizable panels. Borders are often `foreground/[0.04]` to `foreground/[0.10]` rather than hard card outlines.
- **Chat:** user messages are compact gradient bubbles with `rounded-[16px] rounded-br-[6px]`; assistant messages are mostly unboxed markdown/tool rows, not card bubbles.
- **Motion:** small, purposeful transitions: shimmer text while thinking, animated dots, compact popover scale/fade, Mac-style spinner, Rive roundel spinner.
- **Icons:** Fyr uses HugeIcons Pro plus custom brand marks. Icon stroke weight is tuned by size. This should not be copied blindly unless the project has license/access to `@hugeicons-pro`.

## Current Poolside it for me Gap

Current sources reviewed:

- `src/lib/styles/app.css`
- `src/lib/components/ui/Button.svelte`
- `src/lib/components/ui/InlineSelect.svelte`
- `src/lib/components/ui/Section.svelte`
- `src/pages/sidepanel/SidePanelApp.svelte`
- `src/pages/sidepanel/MessageBubble.svelte`
- `src/pages/trace/TraceApp.svelte`

The extension already has some adjacent ideas: compact text, light/dark tokens, Tailwind v4, Lucide icons, and a side-panel chat shell. The main differences are:

- Current palette is warmer/card-like (`#fbfaf6`, `#ffffff`, beige secondary tokens) and dark mode is softer (`#1a1a1a`) than Fyr's sharper neutral shell.
- Controls are rectangular shadcn-like buttons (`rounded-md`, borders) rather than Fyr's pill controls with gradients and inset depth.
- Chat uses boxed assistant bubbles and boxed trace/settings sections; Fyr leaves assistant prose unboxed and reserves rounded containers for user bubbles, tool rows, menus, and true panels.
- Settings and trace screens use many visible cards. Fyr favors panel sections, thin separators, compact rows, and muted outlines.
- Theme support is only `system | light | dark`; Fyr has independent color-scheme and accent-palette preferences.

## Design Tokens To Introduce

Update `src/lib/styles/app.css` first so component work is token-driven.

Recommended token mapping:

```css
:root {
  --background: #fcfcfa;
  --foreground: #0f0f0f;
  --muted-foreground: #737373;
  --border: #e5e5e5;
  --surface: #fcfbf8;
  --card: var(--background);
  --primary: var(--color-ps-accent-500);
  --primary-foreground: #ffffff;
  --accent: color-mix(in srgb, var(--primary) 8%, transparent);
  --accent-foreground: var(--primary);
  --ring: var(--primary);
  --radius: 0.5rem;
  --shadow-menu: 0 0 0 1px rgba(0, 0, 0, 0.08), 0 4px 16px rgba(0, 0, 0, 0.12);
  --shadow-inset-light: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
  --shadow-inset-depth: inset 0 0 0 1px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.1);
}

:root.dark {
  --background: #0a0a0a;
  --foreground: #ededed;
  --muted-foreground: #a1a1a1;
  --border: #262626;
  --surface: #171717;
  --card: var(--background);
  --primary: var(--color-ps-accent-400);
  --primary-foreground: #ffffff;
}
```

Also add the Poolside palettes from Fyr:

- Royal as the default primary accent.
- Bondi and Lime as useful secondary accent options for status/choice UI.
- Grape, Strawberry, Tangerine, Graphite only if we expose an accent picker.

Keep `--card` for compatibility with existing components, but visually make the app less card-heavy by pointing most structural UI to `--background` or `--surface`.

## Typography Plan

Fyr uses `next/font`, but this extension should avoid runtime network font loading. Use a progressive local stack:

- UI: `Geist, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`
- Mono: `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`

Implementation options:

- Low-risk: only update stacks and type scale; no bundled font files.
- Higher fidelity: add self-hosted Geist and JetBrains Mono assets under `src/lib/assets/fonts` or `extension/assets/fonts`, then wire `@font-face` in `app.css`.

The low-risk option is enough for the first pass.

## Component Changes

### 1. Buttons

Change `src/lib/components/ui/Button.svelte` to Fyr-style variants:

- Base: `rounded-full`, `font-medium`, no default rectangular border feel.
- Primary: vertical Poolside accent gradient, white text, inset depth shadow.
- Secondary: neutral gradient, inset light shadow.
- Ghost: transparent, low-contrast hover.
- Danger: neutral button with destructive text unless it is a truly destructive primary action.
- Icon size: keep fixed icon button dimensions, with 14-16px icons.

This single component will shift most of the extension immediately.

### 2. Inputs and Composer

Create a reusable `Input.svelte` or at least a shared input class. Apply it to:

- API key/custom model/max steps inputs in `SidePanelApp.svelte`.
- The chat textarea.
- Any future trace filters/search.

Composer target:

- wrapper: `rounded-[19px] outline outline-foreground/10 bg-surface/40`
- textarea: transparent background, `px-3.5 py-2.5`, `text-base`/13px equivalent
- send button: circular primary pill with arrow/send icon

### 3. Inline Select and Menus

Update `InlineSelect.svelte`:

- Trigger should feel like a compact pill, not a square select.
- Menu should use `--shadow-menu`, `bg-background`, `rounded-lg`, `p-1`, and item hover `bg-foreground/[0.04]`.
- Selected rows should use text foreground plus a small check icon, not strong backgrounds.

This maps directly to Fyr's `DropdownMenu` behavior without needing Base UI.

### 4. Chat Messages

Update `MessageBubble.svelte`:

- User messages: `max-w-[80%] px-2.5 py-1.5 rounded-[16px] rounded-br-[6px] text-white user-bubble`.
- Assistant messages: remove card border/background for normal assistant text; render as `self-start max-w-full text-sm leading-6 text-foreground/90`.
- Tool/status messages: keep compact rows with a small primary dot or icon.
- Error messages: subtle red text/low-alpha background, not a large card unless action is required.

Add `.user-bubble`, `.thinking-text`, and `shimmer-dot` utilities to `app.css`.

### 5. Empty State

Current empty state is already compact, but it should become less boxed:

- Use a muted icon mark instead of a bordered card icon.
- Use `text-muted-foreground` and compact template buttons.
- Optional: introduce a simple Poolside/browser mark, but keep it code-native for now.

### 6. Settings Screen

Move settings away from card sections:

- `Section.svelte` should use panel separators and compact labels, not repeated card containers.
- Field labels can stay mono uppercase, but reduce visual weight.
- Actions should be pill buttons.
- Theme control should become two controls: color scheme and accent theme if we add Fyr palettes.

### 7. Trace View

The trace page can keep more structure because it is inspection-heavy, but should adopt Fyr's tool-row style:

- Reduce `rounded-xl` card density.
- Use `bg-foreground/[0.02]`, `border-foreground/[0.06]`, and compact headers for step cards.
- Use monospace badges for step IDs and tool names.
- For large JSON, keep boxed code blocks; Fyr also boxes code/diff surfaces.

### 8. Icons

Do not add `@hugeicons-pro` unless the project has explicit license and registry access.

Recommended first pass:

- Keep `@lucide/svelte`.
- Normalize icon sizes to 14, 15, 16, and 18px.
- Prefer round/pill button shapes and tuned colors; that will carry more of the Fyr vibe than replacing icons.

Optional later:

- Evaluate `@hugeicons/svelte` or another licensed icon set if the exact icon language matters.
- Add a small local `BrandIcon.svelte` for OpenAI/Chrome/Poolside-like marks where useful.

## Implementation Phases

### Phase 1: Token and Control Pass

Files:

- `src/lib/styles/app.css`
- `src/lib/components/ui/Button.svelte`
- `src/lib/components/ui/InlineSelect.svelte`
- `src/lib/components/ui/Field.svelte`

Expected result: app immediately feels closer to Fyr without restructuring screens.

Validation:

- `npm run verify`
- Build extension and inspect side panel at narrow width.

### Phase 2: Chat Surface Pass

Files:

- `src/pages/sidepanel/SidePanelApp.svelte`
- `src/pages/sidepanel/MessageBubble.svelte`
- `src/pages/sidepanel/EmptyState.svelte`
- `src/pages/sidepanel/ConfirmationCard.svelte`
- `src/pages/sidepanel/SiteAccessCard.svelte`

Expected result: chat becomes the primary workspace, with assistant prose unboxed, gradient user bubbles, and a more tactile composer.

Manual checks:

- Empty chat.
- User/assistant/tool/error messages.
- Running state.
- Confirmation card.
- Site-access recovery.
- Side panel at 320px and 400px widths.

### Phase 3: Settings and Trace Polish

Files:

- `src/lib/components/ui/Section.svelte`
- `src/lib/components/ui/JsonBlock.svelte`
- `src/pages/trace/*.svelte`
- `src/pages/sidepanel/TraceTimeline.svelte`
- `src/pages/sidepanel/HistoryList.svelte`

Expected result: trace/settings views still inspectable, but visually align with the compact panel-shell style.

### Phase 4: Optional Accent Themes

Files:

- `src/lib/theme.ts`
- `src/lib/styles/app.css`
- `src/pages/sidepanel/SidePanelApp.svelte`

Add separate settings:

- Color scheme: `system | light | dark`
- Accent theme: `royal | bondi | lime | strawberry | tangerine | grape | graphite`

Store these independently so users can keep dark mode while changing only the accent palette.

## Risks and Constraints

- **Extension CSP/fonts:** avoid Google-hosted fonts. Prefer system fallback first, then self-host if needed.
- **Icon licensing:** Fyr's `@hugeicons-pro` dependency is not safe to assume. Keep Lucide unless license/access is confirmed.
- **Side-panel width:** Fyr's app has more horizontal room. The Chrome side panel needs stricter truncation, stable icon button sizes, and mobile-style wrapping.
- **Accessibility:** Lower-contrast Fyr-style surfaces need checks for focus states and readable disabled text.
- **Trace readability:** Do not over-minimize trace pages. They are developer/debug tools and need clear hierarchy.

## Acceptance Criteria

- The side panel reads as a compact workspace, not a stack of generic shadcn cards.
- Primary actions use the Poolside accent gradient and pill shape.
- User chat bubbles match Fyr's rounded gradient pattern.
- Assistant text is mostly unboxed and easier to scan.
- Settings and trace sections use thin separators, muted rows, and compact controls.
- Light and dark modes both work, with no low-contrast regressions.
- `npm run verify` passes.
