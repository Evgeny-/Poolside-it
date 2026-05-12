<script lang="ts">
  import { stringify } from "$lib/utils";

  let {
    value,
    maxHeight = "max-h-72"
  }: {
    value: unknown;
    maxHeight?: string;
  } = $props();

  let json = $derived(stringify(value));
</script>

<textarea
  readonly
  spellcheck="false"
  rows="12"
  class={`${maxHeight} min-h-56 w-full resize-y overflow-auto rounded-lg border border-foreground/[0.08] bg-code p-3 font-mono text-xs leading-5 text-code-foreground outline-none selection:bg-accent selection:text-accent-foreground`}
  value={json}
></textarea>
