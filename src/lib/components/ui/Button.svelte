<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";

  type Variant = "primary" | "secondary" | "danger" | "ghost" | "link";
  type Size = "sm" | "md" | "icon";

  let {
    children,
    class: className = "",
    variant = "secondary",
    size = "md",
    type = "button",
    disabled = false,
    title = "",
    ariaLabel = "",
    onclick,
    ...rest
  }: {
    children?: Snippet;
    class?: string;
    variant?: Variant;
    size?: Size;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    onclick?: (event: MouseEvent) => void;
    [key: string]: any;
  } = $props();

  const base = "inline-flex max-w-full min-w-0 items-center justify-center gap-2 rounded-md border text-center text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const variants = {
    primary: "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "border-border bg-transparent text-foreground hover:bg-secondary",
    danger: "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
    ghost: "border-transparent bg-transparent text-foreground hover:bg-secondary",
    link: "border-transparent bg-transparent text-primary hover:underline"
  };
  const sizes = {
    sm: "min-h-7 px-2.5 py-1 text-xs",
    md: "min-h-8 px-3 py-1.5",
    icon: "size-8 p-0"
  };
  const linkSize = "min-h-0 p-0 text-xs";
</script>

<button
  {type}
  {disabled}
  {title}
  aria-label={ariaLabel || undefined}
  class={cn(base, variants[variant], variant === "link" ? linkSize : sizes[size], className)}
  onclick={onclick}
  {...rest}
>
  {@render children?.()}
</button>
