import * as React from "react";
import { Chip } from "@heroui/react";

import { cn } from "@/lib/utils";

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Chip
      className={cn(
        "inline-flex min-h-0 items-center border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-muted-foreground",
        className,
      )}
    >
      {children}
    </Chip>
  );
}
