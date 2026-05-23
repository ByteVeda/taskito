# Taskito bare-metal autoscaler

Production-grade autoscaling for Taskito worker processes — no Kubernetes
required. The control loop runs as a long-lived daemon, polls queue depth
and worker utilisation, and spawns or drains `taskito worker` subprocesses
to converge on the target.

## When to use this vs KEDA

|                        | Bare-metal autoscaler         | KEDA (`deploy/keda/`)         |
| ---------------------- | ----------------------------- | ----------------------------- |
| Runtime                | Single Python daemon          | Kubernetes operator           |
| Scaling unit           | OS process (subprocess.Popen) | Pod replica                   |
| Configuration          | CLI flags or `AutoscaleConfig`| `ScaledObject` CRD            |
| Best for               | Bare metal, Docker, systemd   | Kubernetes clusters           |

Both share the same scaling formula (mirrors Kubernetes HPA), so operators
moving between deployment models don't have to rethink targets.

## Quickstart

```bash
pip install taskito

taskito autoscale \
    --app myapp.tasks:queue \
    --min-workers 1 \
    --max-workers 10 \
    --target-queue-depth 15 \
    --target-utilisation 0.75 \
    --drain-timeout 30
```

## How the scaling formula works

Every `--poll-interval` seconds the controller:

1. Reads `queue.stats()` for `pending` and `running`.
2. Computes the **depth signal** — `ceil(pending / target_queue_depth)`.
3. Computes the **utilisation signal** — `ceil(current * util / target_util)`
   (Kubernetes HPA formula).
4. Takes the max of those two signals, clamps to `[min, max]`.
5. If `running > capacity` (where `capacity = workers * threads_per_worker`),
   forces an immediate +1 to relieve overload.
6. Applies a tolerance band (default 10%) to suppress noise.
7. Smooths through stabilisation windows: scale-up window (default 0s,
   immediate) and scale-down window (default 300s, matches HPA).

## Files

- `systemd-autoscale.service` — production systemd unit. Drop it at
  `/etc/systemd/system/taskito-autoscale.service` and enable with
  `systemctl enable --now taskito-autoscale`.
- `docker-compose-autoscale.yml` — Compose example pairing the autoscaler
  with a Postgres backend. Replace with SQLite / Redis as needed.

## Graceful shutdown

The autoscaler installs SIGTERM and SIGINT handlers. On receipt:

1. Stops the decision loop (no new spawns).
2. Sends SIGTERM to every live worker in parallel.
3. Waits up to `drain_timeout + 5s` per worker; SIGKILLs stragglers.

`systemd-autoscale.service` reserves a 60-second `TimeoutStopSec` to allow
the full drain. Compose users should set `stop_grace_period: 60s` (the
template does).
