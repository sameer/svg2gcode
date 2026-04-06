export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function roundMm(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatMillimeters(value: number) {
  return `${value.toFixed(2)} mm`;
}

export function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}
