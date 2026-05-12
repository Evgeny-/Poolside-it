<script lang="ts">
  import { ShieldAlert } from "@lucide/svelte";
  import Button from "$lib/components/ui/Button.svelte";

  let {
    visible = false,
    busy = false,
    onGrant
  }: {
    visible?: boolean;
    busy?: boolean;
    onGrant: () => void;
  } = $props();
</script>

{#if visible}
  <section class="mx-3 mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[16px] border border-foreground/[0.08] bg-foreground/[0.02] p-3 max-[380px]:grid-cols-1">
    <div class="flex min-w-0 gap-3">
      <div class="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-primary">
        <ShieldAlert size={17} />
      </div>
      <div class="min-w-0">
        <h2 class="text-base font-medium">Website access needed</h2>
        <p class="mt-1 text-sm leading-5 text-muted-foreground">Chrome blocked page access for this site. Grant website access and the panel will retry the blocked action.</p>
      </div>
    </div>
    <Button variant="primary" disabled={busy} onclick={onGrant}>Grant access</Button>
  </section>
{/if}
