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

  const base = "inline-flex max-w-full min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-full text-center font-medium antialiased transition-[background-color,color,filter,box-shadow] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary: "fyr-control-primary",
    secondary: "fyr-control-secondary",
    danger: "fyr-control-danger",
    ghost: "fyr-control-ghost",
    link: "fyr-control-link hover:underline"
  };
  const sizes = {
    sm: "min-h-6 px-2 py-1 text-sm leading-[14px] [&_svg]:size-3.5",
    md: "min-h-7 px-3 py-1.5 text-base leading-[16px] [&_svg]:size-4",
    icon: "size-7 p-0 [&_svg]:size-4"
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
