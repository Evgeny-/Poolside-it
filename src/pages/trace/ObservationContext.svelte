<script lang="ts">
  import ExpandableList from "$lib/components/ui/ExpandableList.svelte";
  import { formatElementSummary, formatEmbeddedFrameSummary, formatFrameSummary } from "$lib/trace/format";
  import { findElementInSnapshot, formatElementLabel } from "$lib/trace/cycles";
  import MetricRow from "./MetricRow.svelte";
  import PropertyList from "./PropertyList.svelte";

  let {
    step,
    targetElementId = ""
  }: {
    step?: any;
    targetElementId?: string;
  } = $props();

  let snapshot = $derived(step?.snapshot || {});
  let targetElement = $derived(findElementInSnapshot(snapshot, targetElementId));
  let hasFrameDetails = $derived(
    (snapshot.frames?.length || 0) > 1 ||
      (snapshot.embeddedFrames?.length || 0) > 0 ||
      (snapshot.frameObservation?.inaccessibleFrameCount || 0) > 0 ||
      targetElement?.frame?.isTopFrame === false
  );
</script>

<details class="group rounded-lg border border-foreground/[0.06] bg-foreground/[0.015] p-3">
  <summary class="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm font-medium text-foreground marker:hidden">
    <span>Observed context</span>
    <MetricRow items={[
      ["Elements", String(snapshot.elements?.length || 0)],
      ["Text", String(snapshot.pageText?.length || 0)],
      ["Frames", String(snapshot.frames?.length || 1)],
      ["Scroll Y", snapshot.viewport?.scrollY === undefined ? "" : String(snapshot.viewport.scrollY)]
    ]} />
  </summary>

  <div class="mt-3 grid gap-3">
    <PropertyList items={[
      ["Title", snapshot.title || step?.title || ""],
      ["URL", snapshot.url || step?.url || ""],
      ["Target", formatElementLabel(targetElement, targetElementId)]
    ]} />

    <section class="grid gap-2">
      <h4 class="text-sm font-medium text-muted-foreground">Visible text</h4>
      <ExpandableList items={snapshot.pageText || []} initialLimit={8} />
    </section>

    <section class="grid gap-2">
      <h4 class="text-sm font-medium text-muted-foreground">Actionable elements</h4>
      <ExpandableList items={snapshot.elements || []} initialLimit={10} formatter={formatElementSummary} />
    </section>

    {#if hasFrameDetails}
      <section class="grid gap-2">
        <h4 class="text-sm font-medium text-muted-foreground">Frames</h4>
        <ExpandableList items={snapshot.frames || []} initialLimit={8} formatter={formatFrameSummary} />
      </section>
    {/if}

    {#if snapshot.embeddedFrames?.length}
      <section class="grid gap-2">
        <h4 class="text-sm font-medium text-muted-foreground">Embedded frames</h4>
        <ExpandableList items={snapshot.embeddedFrames || []} initialLimit={8} formatter={formatEmbeddedFrameSummary} />
      </section>
    {/if}
  </div>
</details>
