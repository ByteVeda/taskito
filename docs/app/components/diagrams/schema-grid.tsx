// Database schema — exact port of the prototype's `.schema-grid` (six SQLite
// tables as `.entity` cards with PK/FK badges). `architecture/storage.mdx`.

type Field = { name: string; key?: "PK" | "FK"; type: string };
type Entity = { name: string; fields: Field[] };

const ENTITIES: Entity[] = [
  {
    name: "jobs",
    fields: [
      { name: "id", key: "PK", type: "TEXT" },
      { name: "queue", type: "TEXT" },
      { name: "task_name", type: "TEXT" },
      { name: "payload", type: "BLOB" },
      { name: "status", type: "INTEGER" },
      { name: "priority", type: "INTEGER" },
      { name: "scheduled_at", type: "INTEGER" },
      { name: "retry_count", type: "INTEGER" },
      { name: "result", type: "BLOB" },
      { name: "timeout_ms", type: "INTEGER" },
      { name: "unique_key", type: "TEXT" },
    ],
  },
  {
    name: "dead_letter",
    fields: [
      { name: "id", key: "PK", type: "TEXT" },
      { name: "original_job_id", type: "TEXT" },
      { name: "task_name", type: "TEXT" },
      { name: "payload", type: "BLOB" },
      { name: "error", type: "TEXT" },
      { name: "retry_count", type: "INTEGER" },
      { name: "failed_at", type: "INTEGER" },
    ],
  },
  {
    name: "job_errors",
    fields: [
      { name: "id", key: "PK", type: "TEXT" },
      { name: "job_id", key: "FK", type: "TEXT" },
      { name: "attempt", type: "INTEGER" },
      { name: "error", type: "TEXT" },
      { name: "failed_at", type: "INTEGER" },
    ],
  },
  {
    name: "rate_limits",
    fields: [
      { name: "key", key: "PK", type: "TEXT" },
      { name: "tokens", type: "REAL" },
      { name: "max_tokens", type: "REAL" },
      { name: "refill_rate", type: "REAL" },
      { name: "last_refill", type: "INTEGER" },
    ],
  },
  {
    name: "periodic_tasks",
    fields: [
      { name: "name", key: "PK", type: "TEXT" },
      { name: "task_name", type: "TEXT" },
      { name: "cron_expr", type: "TEXT" },
      { name: "args", type: "BLOB" },
      { name: "queue", type: "TEXT" },
      { name: "enabled", type: "BOOLEAN" },
      { name: "next_run", type: "INTEGER" },
    ],
  },
  {
    name: "workers",
    fields: [
      { name: "worker_id", key: "PK", type: "TEXT" },
      { name: "last_heartbeat", type: "INTEGER" },
      { name: "queues", type: "TEXT" },
      { name: "status", type: "TEXT" },
    ],
  },
];

export function SchemaGrid() {
  return (
    <div className="schema-grid">
      {ENTITIES.map((e) => (
        <div className="entity" key={e.name}>
          <div className="ehead">{e.name}</div>
          {e.fields.map((f) => (
            <div className="erow" key={f.name}>
              <span className="fn">{f.name}</span>
              {f.key === "PK" ? <span className="pk">PK</span> : null}
              {f.key === "FK" ? <span className="fk">FK</span> : null}
              <span className="ft">{f.type}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
