import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatMillimeters(value: number) {
  return `${value.toFixed(2)} mm`;
}

export function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}
