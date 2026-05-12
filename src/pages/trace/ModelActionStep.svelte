<script lang="ts">
  import ExpandableList from "$lib/components/ui/ExpandableList.svelte";
  import KeyValueGrid from "./KeyValueGrid.svelte";
  import DetailsBlock from "./DetailsBlock.svelte";

  let {
    step
  }: {
    step: any;
  } = $props();

  let toolCall = $derived(step?.toolCall || step?.decision || {});
  let assistantResponse = $derived(toolCall.tool === "respond_to_user" ? toolCall.text || "" : "");
</script>

<div class="grid gap-4">
  <KeyValueGrid items={[
    ["Tool", toolCall.tool || ""],
    ["Element", toolCall.elementId || ""],
    ["Input", toolCall.tool === "fill_element" ? toolCall.text || "" : ""],
    ["Value", toolCall.value || ""],
    ["Key", toolCall.key || ""],
    ["Summary", toolCall.summary || ""],
    ["Risk", toolCall.riskCategory || ""],
    ["Validation", step?.validation?.ok ? "ok" : step?.validation?.reason || ""],
    ["Preview", step?.preview?.status || ""],
    ["Confirmation", step?.confirmation?.decision || ""],
    ["Execution", step?.execution?.status || ""],
    ["Frame", step?.execution?.frameId === undefined ? "" : String(step.execution.frameId)]
  ]} />

  {#if assistantResponse}
    <section class="grid gap-2">
      <h4 class="text-sm font-medium text-muted-foreground">Assistant response</h4>
      <p class="whitespace-pre-wrap rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-3 text-sm leading-5">{assistantResponse}</p>
    </section>
  {/if}

  {#if toolCall.tool === "read_page_text" && step?.execution?.textPage}
    <section class="grid gap-3">
      <h4 class="text-sm font-medium text-muted-foreground">Read visible page text</h4>
      <KeyValueGrid items={[
        ["Cursor", step.execution.textPage.cursor || ""],
        ["Next cursor", step.execution.textPage.nextCursor || ""],
        ["Included items", String(step.execution.textPage.includedItems || 0)],
        ["Truncated", step.execution.textPage.truncated ? "yes" : "no"]
      ]} />
      <ExpandableList items={step.execution.textPage.items || []} initialLimit={24} />
    </section>
  {/if}

  {#if toolCall.reason}
    <section class="grid gap-2">
      <h4 class="text-sm font-medium text-muted-foreground">Reason</h4>
      <p class="whitespace-pre-wrap rounded-lg border border-foreground/[0.06] bg-foreground/[0.02] p-3 text-sm leading-5">{toolCall.reason}</p>
    </section>
  {/if}

  {#if step?.modelRequest}
    <DetailsBlock label="Model request context" value={step.modelRequest} />
  {/if}
  {#if step?.rawModelText}
    <DetailsBlock label="Raw model text" value={step.rawModelText} />
  {/if}
</div>
