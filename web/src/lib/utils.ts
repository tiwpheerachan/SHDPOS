import clsx, { type ClassValue } from "clsx";

// รวมคลาส Tailwind (โปรเจกต์นี้ใช้ clsx ล้วน ไม่มี tailwind-merge)
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
