import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-fd-primary text-fd-primary-foreground hover:opacity-90 transition-opacity",
  secondary:
    "border border-fd-border bg-fd-card hover:bg-fd-accent transition-colors",
  ghost: "text-fd-muted-foreground hover:text-fd-foreground transition-colors",
};

const BASE_CLASSES =
  "inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium";

type CommonProps = {
  variant?: ButtonVariant;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
};

type AsLink = CommonProps & {
  href: string;
} & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">;

type AsButton = CommonProps & {
  href?: undefined;
} & Omit<
    ComponentProps<"button">,
    "className" | "children" | keyof CommonProps
  >;

export function Button(props: AsLink | AsButton) {
  const { variant = "primary", icon, children, className, ...rest } = props;
  const classes = cn(BASE_CLASSES, VARIANT_CLASSES[variant], className);

  if ("href" in rest && rest.href !== undefined) {
    const { href, ...linkRest } = rest;
    return (
      <Link href={href} className={classes} {...linkRest}>
        {children}
        {icon}
      </Link>
    );
  }

  return (
    <button type="button" className={classes} {...(rest as AsButton)}>
      {children}
      {icon}
    </button>
  );
}
