import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@/components/ui";
import { useDeleteSetting, useUpdateSetting } from "../hooks";
import { type ExternalLink, SETTING_KEYS, type SettingsSnapshot } from "../types";

/** Editable link item with a stable client-side id for React keys. */
interface DraftLink extends ExternalLink {
  id: string;
}

/** Generate a stable client-side id for a draft row. Used only as a React
 * key — never persisted, never sent to the server. */
function draftId(): string {
  return crypto.randomUUID();
}

/**
 * Parse the JSON-encoded ``external_links`` setting into a typed list,
 * tolerating malformed values (returns ``[]``) so a bad write never
 * breaks the page.
 */
function parseLinks(raw: string | undefined): ExternalLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ExternalLink =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as ExternalLink).label === "string" &&
          typeof (item as ExternalLink).url === "string",
      )
      .map((item) => ({ label: item.label, url: item.url }));
  } catch {
    return [];
  }
}

/**
 * User-defined links rendered in the sidebar (e.g. wiki, runbook, status
 * page). Stored as a single JSON-encoded array under
 * ``dashboard.external_links``.
 */
export function ExternalLinksSection({ settings }: { settings: SettingsSnapshot }) {
  const update = useUpdateSetting();
  const remove = useDeleteSetting();

  const initial = useMemo(() => parseLinks(settings[SETTING_KEYS.externalLinks]), [settings]);
  const [links, setLinks] = useState<DraftLink[]>(() =>
    initial.map((link) => ({ ...link, id: draftId() })),
  );

  // When the server snapshot changes, reset the local list to match.
  useEffect(() => {
    setLinks(initial.map((link) => ({ ...link, id: draftId() })));
  }, [initial]);

  const dirty = useMemo(() => {
    const stripped = links.map(({ label, url }) => ({ label, url }));
    return JSON.stringify(stripped) !== JSON.stringify(initial);
  }, [links, initial]);

  const updateAt = (id: string, patch: Partial<ExternalLink>) =>
    setLinks((current) => current.map((link) => (link.id === id ? { ...link, ...patch } : link)));

  const removeAt = (id: string) => setLinks((current) => current.filter((link) => link.id !== id));

  const addLink = () => setLinks((current) => [...current, { id: draftId(), label: "", url: "" }]);

  const onSave = () => {
    const cleaned = links
      .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
      .filter((link) => link.label && link.url);
    if (cleaned.length === 0) {
      remove.mutate(SETTING_KEYS.externalLinks);
    } else {
      update.mutate({ key: SETTING_KEYS.externalLinks, value: cleaned });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>External links</CardTitle>
        <CardDescription>
          Custom shortcuts shown in the sidebar — runbooks, dashboards, status pages.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {links.length === 0 ? (
          <p className="text-sm text-[var(--fg-subtle)] py-4">No external links configured.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {links.map((link) => (
              <li
                key={link.id}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-start"
              >
                <Input
                  aria-label="Label"
                  placeholder="Runbook"
                  value={link.label}
                  onChange={(e) => updateAt(link.id, { label: e.target.value })}
                  maxLength={64}
                />
                <Input
                  aria-label="URL"
                  type="url"
                  placeholder="https://example.com/runbook"
                  value={link.url}
                  onChange={(e) => updateAt(link.id, { url: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAt(link.id)}
                  aria-label="Remove link"
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={addLink}>
            <Plus className="size-4" aria-hidden />
            Add link
          </Button>
          <Button onClick={onSave} disabled={!dirty || update.isPending}>
            Save links
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
