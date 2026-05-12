<script lang="ts">
  import { Check, ChevronDown } from "@lucide/svelte";
  import { cn } from "$lib/utils";

  type Option = {
    value: string;
    label: string;
    title?: string;
  };

  let {
    value = $bindable(""),
    options = [],
    placeholder = "Select",
    ariaLabel = "Select option",
    class: className = "",
    buttonClass = "",
    menuClass = "",
    placement = "bottom",
    disabled = false,
    onChange
  }: {
    value?: string;
    options?: readonly Option[];
    placeholder?: string;
    ariaLabel?: string;
    class?: string;
    buttonClass?: string;
    menuClass?: string;
    placement?: "top" | "bottom";
    disabled?: boolean;
    onChange?: (value: string) => void;
  } = $props();

  let open = $state(false);
  let selected = $derived(options.find((option) => option.value === value));

  function choose(option: Option) {
    value = option.value;
    open = false;
    onChange?.(option.value);
  }

  function handleFocusOut(event: FocusEvent) {
    const root = event.currentTarget as HTMLElement;
    const next = event.relatedTarget as Node | null;
    if (!next || !root.contains(next)) {
      open = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      open = false;
    }
  }
</script>

<div class={cn("relative inline-block min-w-0 max-w-full", className)} onfocusout={handleFocusOut}>
  <button
    type="button"
    class={cn(
      "fyr-select-trigger inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-base text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-60",
      buttonClass
    )}
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={open}
    {disabled}
    onclick={() => open = !open}
    onkeydown={handleKeydown}
  >
    <span class="min-w-0 truncate">{selected?.label || placeholder}</span>
    <ChevronDown class={cn("size-3 shrink-0 transition-transform", open ? "rotate-180" : "")} />
  </button>

  {#if open}
    <div
      class={cn(
        "fyr-menu absolute z-30 grid max-h-64 w-max min-w-full max-w-72 overflow-auto rounded-lg bg-popover p-1 text-popover-foreground",
        placement === "top" ? "bottom-full mb-1" : "top-full mt-1",
        menuClass
      )}
      role="listbox"
      aria-label={ariaLabel}
      tabindex="-1"
      onkeydown={handleKeydown}
    >
      {#each options as option}
        <button
          type="button"
          role="option"
          aria-selected={option.value === value}
          title={option.title || option.label}
          class={cn(
            "grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-secondary",
            option.value === value ? "text-foreground" : "text-muted-foreground"
          )}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => choose(option)}
        >
          <span class="min-w-0 truncate">{option.label}</span>
          {#if option.value === value}
            <Check class="size-3.5" />
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
