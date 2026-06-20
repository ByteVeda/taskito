// OpenTelemetry tracing for Taskito task execution. Optional integration —
// import from `taskito/contrib/otel`; requires `@opentelemetry/api` as a peer.
//
// Register with `queue.use(otelMiddleware())`. Each execution attempt becomes one
// span (`taskito.execute.<task>`); a retry is a fresh attempt and thus a new span.

import { type Attributes, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Middleware, TaskContext } from "../middleware";

/** Options for {@link otelMiddleware}. */
export interface OtelMiddlewareOptions {
  /** Tracer name passed to `trace.getTracer` (default `"taskito"`). */
  tracerName?: string;
  /** Prefix for span attribute keys (default `"taskito"`). */
  attributePrefix?: string;
  /** Override the span name (default `"<prefix>.execute.<taskName>"`). */
  spanName?: (ctx: TaskContext) => string;
  /** Extra attributes merged onto the span at start. */
  extraAttributes?: (ctx: TaskContext) => Attributes;
  /** Only trace tasks for which this returns true (default: all). */
  taskFilter?: (taskName: string) => boolean;
}

/**
 * Build {@link Middleware} that wraps each task execution in an OpenTelemetry span.
 * The span starts in `before`, ends `OK` in `after`, and ends `ERROR` (recording the
 * exception) in `onError`.
 */
export function otelMiddleware(options: OtelMiddlewareOptions = {}): Middleware {
  const tracerName = options.tracerName ?? "taskito";
  const prefix = options.attributePrefix ?? "taskito";
  const tracer = trace.getTracer(tracerName);
  const spans = new Map<string, Span>();

  const tracked = (taskName: string): boolean => options.taskFilter?.(taskName) ?? true;

  return {
    before(ctx) {
      if (!tracked(ctx.taskName)) {
        return;
      }
      const name = options.spanName?.(ctx) ?? `${prefix}.execute.${ctx.taskName}`;
      const span = tracer.startSpan(name);
      span.setAttribute(`${prefix}.job_id`, ctx.jobId);
      span.setAttribute(`${prefix}.task_name`, ctx.taskName);
      const extra = options.extraAttributes?.(ctx);
      if (extra) {
        span.setAttributes(extra);
      }
      spans.set(ctx.jobId, span);
    },

    after(ctx) {
      const span = spans.get(ctx.jobId);
      if (!span) {
        return;
      }
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      spans.delete(ctx.jobId);
    },

    onError(ctx, error) {
      const span = spans.get(ctx.jobId);
      if (!span) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      span.recordException(error instanceof Error ? error : message);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.end();
      spans.delete(ctx.jobId);
    },
  };
}
