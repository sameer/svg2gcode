import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { FrontendOperation, GenerateJobResponse } from "@/lib/types";
import { formatMillimeters } from "@/lib/utils";

interface PreviewSidebarProps {
  generated: GenerateJobResponse | null;
  operations: FrontendOperation[];
  error: string | null;
}

export function PreviewSidebar({
  generated,
  operations,
  error,
}: PreviewSidebarProps) {
  if (!generated) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Click "Make Path" to generate the toolpath.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <SidebarSection title="Operations" defaultOpen>
        <div className="space-y-2">
          {operations.map((op) => (
            <div key={op.id} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: op.color ?? "#2563eb" }}
              />
              <span className="flex-1 truncate">{op.name}</span>
              <span className="text-xs text-muted-foreground">
                {formatMillimeters(op.target_depth_mm)}
              </span>
              <Badge className="text-[10px] px-1.5 py-0">
                {op.assigned_element_ids.length}
              </Badge>
            </div>
          ))}
        </div>
      </SidebarSection>

      {generated.warnings.length > 0 && (
        <SidebarSection title="Warnings" defaultOpen>
          <div className="space-y-1.5">
            {generated.warnings.map((w) => (
              <div
                key={w}
                className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {w}
              </div>
            ))}
          </div>
        </SidebarSection>
      )}

      {error && (
        <div className="mx-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <SidebarSection title="G-Code" defaultOpen={false}>
        <textarea
          className="h-64 w-full rounded-md border border-border bg-slate-950 p-3 font-mono text-[10px] leading-relaxed text-slate-300"
          value={generated.gcode}
          readOnly
        />
      </SidebarSection>
    </div>
  );
}

function SidebarSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {title}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}
