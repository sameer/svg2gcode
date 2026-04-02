/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Button as HeroButton } from "@heroui/react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[1rem] text-sm font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-45 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45",
  {
    variants: {
      variant: {
        default:
          "border border-primary/30 bg-primary text-primary-foreground shadow-[0_10px_30px_rgba(33,143,255,0.28)] hover:border-primary/50 hover:bg-[#4ba7ff]",
        secondary:
          "border border-white/8 bg-white/8 text-secondary-foreground hover:bg-white/12",
        outline:
          "border border-white/14 bg-white/[0.03] text-foreground hover:border-primary/35 hover:bg-white/[0.08]",
        ghost:
          "border border-transparent bg-transparent text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
        destructive:
          "border border-red-500/30 bg-red-500/14 text-red-100 hover:bg-red-500/24",
      },
      size: {
        default: "h-10 px-4 py-2 text-sm",
        sm: "h-8 rounded-[0.9rem] px-3 text-xs",
        lg: "h-11 px-8 text-base",
        icon: "h-9 w-9 rounded-[0.95rem] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends Omit<
      React.ComponentPropsWithoutRef<typeof HeroButton>,
      "className" | "variant" | "size" | "isDisabled"
    >,
    VariantProps<typeof buttonVariants> {
  className?: string;
  disabled?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, disabled, ...props }, ref) => (
    <HeroButton
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      isDisabled={disabled}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
