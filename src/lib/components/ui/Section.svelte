<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  let {
    title,
    children,
    class: className = "",
    actions
  }: {
    title: string;
    children?: Snippet;
    actions?: Snippet;
    class?: string;
  } = $props();
</script>

<section class={cn("grid gap-3 border-b border-border p-4", className)}>
  <div class="flex min-w-0 items-center justify-between gap-3">
    <h2 class="font-mono-ui truncate text-xs font-medium uppercase tracking-normal text-muted-foreground">{title}</h2>
    {#if actions}
      <div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        {@render actions()}
      </div>
    {/if}
  </div>
  {@render children?.()}
</section>
