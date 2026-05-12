<script lang="ts">
  import Button from "$lib/components/ui/Button.svelte";

  let {
    pending,
    onApprove,
    onReject
  }: {
    pending: any;
    onApprove: () => void;
    onReject: () => void;
  } = $props();
</script>

{#if pending}
  <section class="mx-3 mb-3 grid gap-2 rounded-[16px] border border-warning/40 bg-warning/10 p-3">
    <div>
      <h2 class="text-base font-medium text-warning-foreground">{pending.title}</h2>
      <p class="mt-1 text-sm leading-5 text-warning-foreground/80">{pending.reason}</p>
    </div>
    <div class="flex justify-end gap-2">
      <Button size="sm" onclick={onReject}>Cancel</Button>
      <Button size="sm" variant="primary" onclick={onApprove}>Approve</Button>
    </div>
  </section>
{/if}
