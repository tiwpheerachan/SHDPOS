"use client";

import { create } from "zustand";
import { nanoid } from "nanoid";
import { Toast, type ToastTone } from "./ui";

interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
}

interface ToastState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id">, ttl?: number) => void;
  remove: (id: string) => void;
}

export const useToast = create<ToastState>((set, get) => ({
  items: [],
  push: (t, ttl = 3800) => {
    const id = nanoid();
    set((s) => ({ items: [...s.items, { ...t, id }] }));
    if (ttl > 0) setTimeout(() => get().remove(id), ttl);
  },
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export function ToastHost() {
  const { items, remove } = useToast();
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 items-end no-print">
      {items.map((t) => (
        <Toast key={t.id} tone={t.tone} title={t.title} body={t.body} onClose={() => remove(t.id)} />
      ))}
    </div>
  );
}
