<script lang="ts">
  import ExpandableList from "$lib/components/ui/ExpandableList.svelte";
  import { formatElementSummary, formatEmbeddedFrameSummary, formatFrameSummary } from "$lib/trace/format";
  import KeyValueGrid from "./KeyValueGrid.svelte";

  let {
    step
  }: {
    step: any;
  } = $props();

  let snapshot = $derived(step?.snapshot || {});
</script>

<div class="grid gap-4">
  <KeyValueGrid items={[
    ["URL", snapshot.url || step?.url || ""],
    ["Title", snapshot.title || step?.title || ""],
    ["Frames", String(snapshot.frames?.length || 1)],
    ["Elements", String(snapshot.elements?.length || 0)],
    ["Text snippets", String(snapshot.pageText?.length || 0)]
  ]} />

  {#if snapshot.frames?.length}
    <section class="grid gap-2">
      <h4 class="text-sm font-medium text-muted-foreground">Frames</h4>
      <ExpandableList items={snapshot.frames} initialLimit={12} formatter={formatFrameSummary} />
    </section>
  {/if}

  {#if snapshot.embeddedFrames?.length}
    <section class="grid gap-2">
      <h4 class="text-sm font-medium text-muted-foreground">Embedded frames</h4>
      <ExpandableList items={snapshot.embeddedFrames} initialLimit={12} formatter={formatEmbeddedFrameSummary} />
    </section>
  {/if}

  <section class="grid gap-2">
    <h4 class="text-sm font-medium text-muted-foreground">Visible text</h4>
    <ExpandableList items={snapshot.pageText || []} initialLimit={12} />
  </section>

  <section class="grid gap-2">
    <h4 class="text-sm font-medium text-muted-foreground">Actionable elements</h4>
    <ExpandableList items={snapshot.elements || []} initialLimit={18} formatter={formatElementSummary} />
  </section>
</div>
