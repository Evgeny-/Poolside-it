<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  let {
    label,
    children,
    class: className = ""
  }: {
    label: string;
    children?: Snippet;
    class?: string;
  } = $props();
</script>

<label class={cn("font-mono-ui grid gap-1.5 text-xs font-medium uppercase text-muted-foreground", className)}>
  <span>{label}</span>
  {@render children?.()}
</label>
