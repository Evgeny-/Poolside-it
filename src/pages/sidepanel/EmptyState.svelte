<script lang="ts">
  import { ArrowUpRight } from "@lucide/svelte";

  let {
    onPrompt
  }: {
    onPrompt?: (prompt: string) => void;
  } = $props();

  const prompts = [
    "Explain this page",
    "Find the main actions",
    "Summarize visible text"
  ];
</script>

<section class="grid flex-1 place-items-center px-6 py-10 text-center">
  <div class="grid max-w-72 justify-items-center gap-5">
    <div class="relative grid size-16 place-items-center rounded-md border border-border bg-card shadow-panel">
      <img
        class="size-10"
        src="assets/brand/poolside-logomark-solid-color.svg"
        alt=""
        aria-hidden="true"
      />
      <span class="absolute -bottom-px left-2 right-2 h-px bg-primary/60"></span>
    </div>

    <div class="grid gap-1.5">
      <h2 class="text-base font-semibold text-foreground">Poolside it for me</h2>
      <p class="text-sm leading-6 text-muted-foreground">
        Ask for a quick read, a form draft, or a controlled browser action.
      </p>
    </div>

    <div class="grid w-full gap-1.5">
      {#each prompts as prompt}
        <button
          type="button"
          class="group grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          onclick={() => onPrompt?.(prompt)}
        >
          <span class="min-w-0 truncate">{prompt}</span>
          <ArrowUpRight class="size-3.5 opacity-60 transition-opacity group-hover:opacity-100" />
        </button>
      {/each}
    </div>
  </div>
</section>
