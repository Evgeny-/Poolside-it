<script lang="ts">
  import { ArrowUpRight } from "@lucide/svelte";

  let {
    onPrompt
  }: {
    onPrompt?: (prompt: string) => void;
  } = $props();

  const prompts = [
    "Find a millionaire idea here",
    "Find how to contact support",
    "Explain this like I’m a 5yo granny"
  ];
</script>

<section class="grid flex-1 place-items-center px-6 py-10 text-center">
  <div class="grid max-w-72 justify-items-center gap-5">
    <div class="relative grid size-14 place-items-center text-primary">
      <img
        class="size-10"
        src="assets/brand/poolside-logomark-solid-color.svg"
        alt=""
        aria-hidden="true"
      />
    </div>

    <div class="grid gap-1.5">
      <h2 class="text-xl font-medium text-foreground">Poolside it for me</h2>
      <p class="text-base leading-6 text-muted-foreground">
        Ask for a quick read, a form draft, or a controlled browser action.
      </p>
    </div>

    <div class="grid w-full gap-1.5">
      {#each prompts as prompt}
        <button
          type="button"
          class="group grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-full bg-foreground/[0.03] px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          onclick={() => onPrompt?.(prompt)}
        >
          <span class="min-w-0 truncate">{prompt}</span>
          <ArrowUpRight class="size-3.5 opacity-60 transition-opacity group-hover:opacity-100" />
        </button>
      {/each}
    </div>
  </div>
</section>
