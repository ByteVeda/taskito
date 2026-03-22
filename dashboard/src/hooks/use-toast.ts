import { signal } from "@preact/signals";

export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

export const toasts = signal<Toast[]>([]);

let counter = 0;

export function addToast(message: string, type: Toast["type"] = "info", duration = 3000): void {
  const id = String(++counter);
  toasts.value = [...toasts.value, { id, message, type }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, duration);
}

export function dismissToast(id: string): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}
