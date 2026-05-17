import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// ui-ux-pro-max checklist applied (Session 9):
//  • `motion-safe:active:scale-[0.97]` — respects prefers-reduced-motion
//    (was unconditional scale → fails the `reduced-motion` rule in §1 a11y)
//  • `cursor-pointer` — explicit on enabled state (rule `cursor-pointer`
//    in §2 Touch & Interaction); `disabled:cursor-not-allowed` makes the
//    disabled-state non-interactive cue OS-native.
//  • `focus-visible:ring-2` already present — matches `focus-states` rule
//  • duration-150 already inside the 150-300ms band — matches
//    `duration-timing` rule in §7 Animation
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 motion-safe:active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
        brand: "bg-gradient-to-r from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))] text-white hover:opacity-90 shadow-sm",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-card hover:bg-muted/50 text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-muted/50 text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // ui-ux-pro-max §2 touch-target-size: ≥44pt for primary CTAs.
        // size="lg" bumped h-10 → h-11 (44px) to meet the rule. `default`
        // stays 36px since it's for desktop-pointer secondary actions where
        // 44px would feel oversized. Icon-only also bumped 9 → 10 (40px) +
        // hitSlop-style padding implicit via [&_svg]:size-4.
        default: "h-9 px-5 py-2",
        sm: "h-8 px-4 text-xs",
        lg: "h-11 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
