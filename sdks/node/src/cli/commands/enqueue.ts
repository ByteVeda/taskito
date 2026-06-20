import type { Command } from "commander";
import { connect, type GlobalOptions } from "../connect";
import { printJson } from "../output";

interface EnqueueOptions {
  queue?: string;
  priority?: string;
  maxRetries?: string;
  delayMs?: string;
  uniqueKey?: string;
}

export function registerEnqueue(program: Command): void {
  program
    .command("enqueue <task> [argsJson]")
    .description("Enqueue a task with a JSON array of args")
    .option("-q, --queue <name>", "target queue")
    .option("--priority <n>", "priority")
    .option("--max-retries <n>", "max retries")
    .option("--delay-ms <n>", "delay before the job runs (ms)")
    .option("--unique-key <key>", "idempotency key")
    .action(
      (task: string, argsJson: string | undefined, options: EnqueueOptions, command: Command) => {
        const queue = connect(command.optsWithGlobals() as GlobalOptions);
        const args = argsJson ? (JSON.parse(argsJson) as unknown[]) : [];
        const id = queue.enqueue(task, args, {
          queue: options.queue,
          priority: numeric(options.priority),
          maxRetries: numeric(options.maxRetries),
          delayMs: numeric(options.delayMs),
          uniqueKey: options.uniqueKey,
        });
        printJson({ id });
      },
    );
}

function numeric(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}
