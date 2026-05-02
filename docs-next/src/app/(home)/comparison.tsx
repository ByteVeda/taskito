"use client";

import { useState } from "react";

type Stack = "taskito" | "celery";

const STACKS: Record<
  Stack,
  {
    label: string;
    services: string;
    install: string;
    code: string;
  }
> = {
  taskito: {
    label: "taskito",
    services: "1 process",
    install: "pip install taskito",
    code: `from taskito import Queue

queue = Queue(db_path="tasks.db")

@queue.task(max_retries=3, rate_limit="100/m")
def send_email(to, subject, body):
    smtp.send(to, subject, body)

# Enqueue
send_email.delay("alice@example.com", "Hi", "Body")

# Run the worker
# $ taskito worker --app tasks:queue`,
  },
  celery: {
    label: "Celery + Redis",
    services: "3 processes (Redis + worker + beat)",
    install: "pip install celery[redis]\n# also: install + run Redis server",
    code: `from celery import Celery

app = Celery(
    "myapp",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
)
app.conf.task_default_rate_limit = "100/m"

@app.task(bind=True, max_retries=3)
def send_email(self, to, subject, body):
    try:
        smtp.send(to, subject, body)
    except SMTPError as exc:
        raise self.retry(exc=exc, countdown=60)

# Enqueue
send_email.delay("alice@example.com", "Hi", "Body")

# Run the worker (in a separate terminal, plus Redis)
# $ celery -A myapp worker --loglevel=info`,
  },
};

export function Comparison() {
  const [stack, setStack] = useState<Stack>("taskito");
  const data = STACKS[stack];

  return (
    <div className="rounded-lg border border-fd-border bg-fd-card overflow-hidden">
      <div className="flex border-b border-fd-border" role="tablist">
        {(Object.keys(STACKS) as Stack[]).map((key) => {
          const active = stack === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStack(key)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                active
                  ? "bg-fd-primary/10 text-fd-foreground border-b-2 border-fd-primary -mb-px"
                  : "text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-accent/50"
              }`}
            >
              {STACKS[key].label}
            </button>
          );
        })}
      </div>
      <div className="grid sm:grid-cols-3 gap-px bg-fd-border">
        <Stat label="Install" value={data.install} mono />
        <Stat label="Services to run" value={data.services} />
        <Stat
          label="Background"
          value={
            stack === "taskito"
              ? "Single Python process"
              : "Worker process + Redis daemon"
          }
        />
      </div>
      <pre className="p-5 text-sm font-mono leading-relaxed overflow-x-auto bg-fd-card">
        <code>{data.code}</code>
      </pre>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-fd-card px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-fd-muted-foreground mb-1">
        {label}
      </div>
      <div
        className={`text-sm whitespace-pre-line ${mono ? "font-mono" : "font-medium"}`}
      >
        {value}
      </div>
    </div>
  );
}
