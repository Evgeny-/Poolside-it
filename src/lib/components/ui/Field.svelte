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

<label class={cn("grid gap-1.5 text-sm font-medium text-muted-foreground", className)}>
  <span class="text-muted-foreground/85">{label}</span>
  {@render children?.()}
</label>
