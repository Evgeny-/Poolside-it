<script lang="ts">
  import { ExternalLink } from "@lucide/svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { formatDate } from "$lib/utils";

  let {
    history = [],
    onLoad,
    onOpen
  }: {
    history?: any[];
    onLoad: (taskId: string) => void;
    onOpen: (taskId: string) => void;
  } = $props();
</script>

<div class="grid gap-2">
  {#if !history.length}
    <div class="rounded-lg border border-dashed border-border/80 bg-foreground/[0.02] p-3 text-sm text-muted-foreground">No task history.</div>
  {:else}
    {#each history as record}
      <article class="grid gap-2 rounded-[16px] border border-foreground/[0.06] bg-foreground/[0.02] p-3">
        <div class="flex items-start justify-between gap-2 text-base font-medium">
          <span>{record.status}</span>
          <span class="text-xs text-muted-foreground">{record.instruction || record.taskId}</span>
        </div>
        <div class="break-words text-xs leading-5 text-muted-foreground">{formatDate(record.updatedAt)} - {record.title || record.url || "active tab"}</div>
        <div class="break-words text-xs leading-5 text-muted-foreground">{record.summary || `${record.stepCount || 0} trace steps`}</div>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" onclick={() => onLoad(record.taskId)}>Load trace</Button>
          <Button size="sm" onclick={() => onOpen(record.taskId)}>
            <ExternalLink size={14} />
            Open details
          </Button>
        </div>
      </article>
    {/each}
  {/if}
</div>
