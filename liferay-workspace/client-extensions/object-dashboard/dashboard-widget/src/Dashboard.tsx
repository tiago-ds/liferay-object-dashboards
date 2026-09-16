import { useMemo, useState } from "react";
import ClayButton from "@clayui/button";
import { ChartView } from "./ChartView";
import { ConfigPanel } from "./ConfigPanel";
import type { ChartConfig } from "./types";

interface Props {
  instanceId: string;
}

const STORAGE_PREFIX = "object-dashboard:";

function loadConfig(instanceId: string): ChartConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + instanceId);
    return raw ? (JSON.parse(raw) as ChartConfig) : null;
  } catch {
    return null;
  }
}

function saveConfig(instanceId: string, config: ChartConfig): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + instanceId, JSON.stringify(config));
  } catch {
    /* localStorage unavailable (private mode) — config just won't persist */
  }
}

function describe(config: ChartConfig): string {
  const verb = config.aggregation === "count" ? "Count" : `${cap(config.aggregation)} of ${config.measure}`;
  const by = config.dateBucket ? `${config.dimension} (${config.dateBucket})` : config.dimension;
  const where = config.strategy === "server" ? " · server-side" : "";
  return `${verb} by ${by}${where}`;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function Dashboard({ instanceId }: Props) {
  const [config, setConfig] = useState<ChartConfig | null>(() => loadConfig(instanceId));
  // An unconfigured widget opens straight into the config panel.
  const [editing, setEditing] = useState(() => loadConfig(instanceId) === null);

  const title = useMemo(() => (config ? config.objectErc : "New chart"), [config]);

  function handleSave(next: ChartConfig) {
    saveConfig(instanceId, next);
    setConfig(next);
    setEditing(false);
  }

  return (
    <div className="od-root">
      <div className="od-header">
        <div>
          <p className="od-title">{title}</p>
          {config && !editing && <p className="od-subtitle">{describe(config)}</p>}
        </div>
        {config && !editing && (
          <ClayButton displayType="secondary" small onClick={() => setEditing(true)}>
            Edit
          </ClayButton>
        )}
      </div>

      {editing ? (
        <ConfigPanel
          current={config}
          onSave={handleSave}
          onCancel={config ? () => setEditing(false) : undefined}
        />
      ) : config ? (
        <ChartView config={config} />
      ) : null}
    </div>
  );
}
