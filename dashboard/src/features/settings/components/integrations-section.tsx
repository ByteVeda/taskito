import { useEffect, useState } from "react";
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
import { SETTING_KEYS, type SettingsSnapshot } from "../types";
import { SettingRow } from "./setting-row";

/**
 * Single-URL integration shortcuts. When set, the dashboard surfaces
 * "View in Grafana / Sentry / OTel" links on the relevant pages
 * (job detail, metrics, etc.).
 */
export function IntegrationsSection({ settings }: { settings: SettingsSnapshot }) {
  const update = useUpdateSetting();
  const remove = useDeleteSetting();

  const [grafana, setGrafana] = useState("");
  const [sentry, setSentry] = useState("");
  const [otel, setOtel] = useState("");

  useEffect(() => {
    setGrafana(settings[SETTING_KEYS.integrationGrafana] ?? "");
    setSentry(settings[SETTING_KEYS.integrationSentry] ?? "");
    setOtel(settings[SETTING_KEYS.integrationOtel] ?? "");
  }, [settings]);

  const dirty =
    grafana !== (settings[SETTING_KEYS.integrationGrafana] ?? "") ||
    sentry !== (settings[SETTING_KEYS.integrationSentry] ?? "") ||
    otel !== (settings[SETTING_KEYS.integrationOtel] ?? "");

  const persist = (key: string, value: string) => {
    if (value) update.mutate({ key, value });
    else remove.mutate(key);
  };

  const onSave = () => {
    persist(SETTING_KEYS.integrationGrafana, grafana);
    persist(SETTING_KEYS.integrationSentry, sentry);
    persist(SETTING_KEYS.integrationOtel, otel);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
        <CardDescription>External observability tools. URLs are deployment-wide.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-[var(--border)]">
        <SettingRow
          label="Grafana"
          description="Base URL of your Grafana instance."
          htmlFor="integration-grafana"
        >
          <Input
            id="integration-grafana"
            type="url"
            placeholder="https://grafana.example.com"
            value={grafana}
            onChange={(e) => setGrafana(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="Sentry"
          description="Sentry project or organization URL."
          htmlFor="integration-sentry"
        >
          <Input
            id="integration-sentry"
            type="url"
            placeholder="https://sentry.io/organizations/acme/"
            value={sentry}
            onChange={(e) => setSentry(e.target.value)}
          />
        </SettingRow>
        <SettingRow
          label="OpenTelemetry collector"
          description="Endpoint of your OTel collector — used for trace links."
          htmlFor="integration-otel"
        >
          <Input
            id="integration-otel"
            type="url"
            placeholder="https://collector.example.com"
            value={otel}
            onChange={(e) => setOtel(e.target.value)}
          />
        </SettingRow>
        <div className="flex justify-end pt-4">
          <Button onClick={onSave} disabled={!dirty || update.isPending}>
            Save integrations
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
