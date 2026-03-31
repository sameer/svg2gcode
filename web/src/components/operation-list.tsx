import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FillMode, FrontendOperation } from "@/lib/types";

interface OperationListProps {
  operations: FrontendOperation[];
  activeOperationId: string | null;
  selectedCount: number;
  onActivate: (operationId: string) => void;
  onAddOperation: () => void;
  onDeleteOperation: (operationId: string) => void;
  onRenameOperation: (operationId: string, value: string) => void;
  onDepthChange: (operationId: string, value: number) => void;
  onOperationFillModeChange: (operationId: string, value: FillMode | null) => void;
  onAssignSelected: (operationId: string) => void;
}

export function OperationList({
  operations,
  activeOperationId,
  selectedCount,
  onActivate,
  onAddOperation,
  onDeleteOperation,
  onRenameOperation,
  onDepthChange,
  onOperationFillModeChange,
  onAssignSelected,
}: OperationListProps) {
  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Operations
        </span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onAddOperation}>
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>
      <div className="space-y-2 px-4 pb-3">
        {operations.map((operation) => (
          <div
            key={operation.id}
            className={`rounded-lg border p-3 transition-colors ${
              activeOperationId === operation.id ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <button className="flex items-center gap-2 text-left" onClick={() => onActivate(operation.id)}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: operation.color ?? "#2563eb" }} />
                <span className="text-xs font-semibold">{operation.name}</span>
              </button>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onDeleteOperation(operation.id)} disabled={operations.length === 1}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <div className="grid gap-1">
                <Label className="text-[10px]">Name</Label>
                <Input
                  className="h-7 text-xs"
                  value={operation.name}
                  onChange={(e) => onRenameOperation(operation.id, e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-[10px]">Depth</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.1"
                    className="h-7 pr-9 text-xs"
                    value={operation.target_depth_mm}
                    onChange={(e) =>
                      onDepthChange(operation.id, Number.parseFloat(e.target.value || "0"))
                    }
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">mm</span>
                </div>
              </div>
              <div className="grid gap-1">
                <Label className="text-[10px]">Fill</Label>
                <select
                  className="h-7 rounded-md border border-border bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                  value={operation.fill_mode ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    onOperationFillModeChange(
                      operation.id,
                      val === "" ? null : (val as FillMode),
                    );
                  }}
                >
                  <option value="">Default</option>
                  <option value="Pocket">Pocket</option>
                  <option value="Contour">Contour</option>
                </select>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Badge className="text-[10px] px-1.5 py-0">{operation.assigned_element_ids.length} parts</Badge>
              <Button size="sm" variant="secondary" className="h-6 px-2 text-[10px]" onClick={() => onAssignSelected(operation.id)}>
                Assign {selectedCount > 0 ? `${selectedCount} selected` : "selection"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
