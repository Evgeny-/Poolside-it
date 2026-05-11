import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function stringify(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export function formatDate(value: string | number | Date | null | undefined, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: options.second || undefined,
    ...options
  }).format(new Date(value));
}
