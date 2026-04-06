const OPERATION_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function colorForOperation(index: number) {
  return OPERATION_COLORS[index % OPERATION_COLORS.length];
}
