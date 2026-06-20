import type { Command } from "commander";
import { connect, type GlobalOptions } from "../connect";
import { printJson } from "../output";
import { numberFlag, parseArgsArray } from "../parse";

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
        const args = parseArgsArray(argsJson);
        const id = queue.enqueue(task, args, {
          queue: options.queue,
          priority: numberFlag(options.priority, "priority"),
          maxRetries: numberFlag(options.maxRetries, "max-retries"),
          delayMs: numberFlag(options.delayMs, "delay-ms"),
          uniqueKey: options.uniqueKey,
        });
        printJson({ id });
      },
    );
}
