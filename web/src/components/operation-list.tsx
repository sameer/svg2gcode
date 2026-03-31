import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FrontendOperation } from "@/lib/types";

interface OperationListProps {
  operations: FrontendOperation[];
  activeOperationId: string | null;
  selectedCount: number;
  onActivate: (operationId: string) => void;
  onAddOperation: () => void;
  onDeleteOperation: (operationId: string) => void;
  onMoveOperation: (operationId: string, direction: "up" | "down") => void;
  onRenameOperation: (operationId: string, value: string) => void;
  onDepthChange: (operationId: string, value: number) => void;
  onAssignSelected: (operationId: string) => void;
}

export function OperationList({
  operations,
  activeOperationId,
  selectedCount,
  onActivate,
  onAddOperation,
  onDeleteOperation,
  onMoveOperation,
  onRenameOperation,
  onDepthChange,
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
        {operations.map((operation, index) => (
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
              <div className="flex items-center gap-0.5">
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onMoveOperation(operation.id, "up")} disabled={index === 0}>
                  <ArrowUp className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onMoveOperation(operation.id, "down")} disabled={index === operations.length - 1}>
                  <ArrowDown className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onDeleteOperation(operation.id)} disabled={operations.length === 1}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
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
