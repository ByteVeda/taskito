import { cn } from "@/lib/cn";

export type SectionHeaderAlign = "center" | "left";

export function SectionHeader({
  title,
  description,
  align = "center",
  className,
}: {
  title: string;
  description?: string;
  align?: SectionHeaderAlign;
  className?: string;
}) {
  return (
    <div
      className={cn(
        align === "center" ? "text-center" : "text-left",
        "mb-12",
        className,
      )}
    >
      <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
        {title}
      </h2>
      {description ? (
        <p className="text-fd-muted-foreground text-lg">{description}</p>
      ) : null}
    </div>
  );
}
