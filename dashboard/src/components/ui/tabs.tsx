import * as TabsPrimitive from "@radix-ui/react-tabs";
import { type ComponentPropsWithoutRef, forwardRef } from "react";
import { cn } from "@/lib/cn";

const Tabs = TabsPrimitive.Root;

const TabsList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex h-9 items-center gap-0.5 rounded-md bg-[var(--surface-2)] p-0.5 ring-1 ring-inset ring-[var(--border)]",
        className,
      )}
      {...props}
    />
  ),
);
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-all",
      "text-[var(--fg-subtle)] hover:text-[var(--fg)]",
      "data-[state=active]:bg-[var(--surface)] data-[state=active]:text-[var(--fg)] data-[state=active]:shadow-xs",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
      "disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsContent, TabsList, TabsTrigger };
