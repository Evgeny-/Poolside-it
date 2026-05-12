<script lang="ts">
  import { ExternalLink } from "@lucide/svelte";
  import Button from "$lib/components/ui/Button.svelte";

  let {
    message,
    content,
    showRunDetails = false,
    onOpenTrace
  }: {
    message: any;
    content: string;
    showRunDetails?: boolean;
    onOpenTrace?: (traceId: string) => void;
  } = $props();

  let role = $derived(message?.role || "assistant");
  let isTool = $derived(role === "tool");
  let isUser = $derived(role === "user");
  let isError = $derived(message?.kind === "error" || role === "error");
</script>

<div
  class={[
    "group relative text-base leading-5",
    isUser ? "user-bubble max-w-[80%] self-end rounded-[16px] rounded-br-[6px] px-2.5 py-1.5 text-white shadow-none" : "",
    !isUser && !isTool && !isError ? "max-w-full self-start px-0 py-1 text-foreground/90" : "",
    isError ? "max-w-full self-start rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-destructive" : "",
    isTool ? "grid max-w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 self-start p-1 text-xs text-muted-foreground" : "",
    message?.traceId && isUser ? "rounded-br-sm" : ""
  ].filter(Boolean).join(" ")}
>
  {#if isTool}
    <span class="size-1.5 rounded-full bg-primary"></span>
  {/if}
  <div class="min-w-0 whitespace-pre-wrap break-words">{content}</div>
  {#if showRunDetails && message?.traceId}
    <Button
      class="pointer-events-none absolute -bottom-3 right-2 size-6 rounded-full border-border bg-background p-0 text-muted-foreground opacity-0 shadow-panel transition-opacity hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto focus:opacity-100"
      variant="secondary"
      size="icon"
      title="Run details"
      ariaLabel="Run details"
      onclick={() => onOpenTrace?.(message.traceId)}
    >
      <ExternalLink size={12} />
    </Button>
  {/if}
</div>
