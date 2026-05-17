import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { useEventTypes } from "../hooks";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** When ``true``, an empty array means "all events" and is rendered as a hint. */
  allowAll?: boolean;
}

export function EventTypeMultiSelect({
  value,
  onChange,
  placeholder = "All events",
  allowAll = true,
}: Props) {
  const { data: events = [] } = useEventTypes();
  const [open, setOpen] = useState(false);

  function toggle(event: string) {
    if (value.includes(event)) {
      onChange(value.filter((e) => e !== event));
    } else {
      onChange([...value, event]);
    }
  }

  const label =
    value.length === 0
      ? allowAll
        ? placeholder
        : "Select events…"
      : `${value.length} event${value.length === 1 ? "" : "s"} selected`;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen((v) => !v)}
          className="w-full justify-between"
        >
          <span className={cn(value.length === 0 && "text-[var(--fg-subtle)]")}>{label}</span>
          <ChevronDown className="size-4" aria-hidden />
        </Button>
        {open ? (
          <div className="absolute z-30 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] shadow-md">
            <Command>
              <CommandInput placeholder="Filter events…" />
              <CommandList className="max-h-64">
                <CommandEmpty>No events match.</CommandEmpty>
                <CommandGroup>
                  {events.map((event) => {
                    const selected = value.includes(event);
                    return (
                      <CommandItem
                        key={event}
                        onSelect={() => toggle(event)}
                        className="cursor-pointer"
                      >
                        <Check
                          className={cn("size-4", selected ? "opacity-100" : "opacity-0")}
                          aria-hidden
                        />
                        <span>{event}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        ) : null}
      </div>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {value.map((event) => (
            <Badge key={event} tone="info" className="font-mono text-[11px]">
              {event}
              <button
                type="button"
                onClick={() => toggle(event)}
                aria-label={`Remove ${event}`}
                className="ml-1 text-[var(--fg-subtle)] hover:text-[var(--fg)]"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
