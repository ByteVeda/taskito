import type { Command } from "commander";
import { connect, type GlobalOptions } from "../connect";
import { printJson, printTable } from "../output";

export function registerDlq(program: Command): void {
  const dlq = program.command("dlq").description("Dead-letter queue operations");

  dlq
    .command("list")
    .description("List dead-letter entries")
    .option("--limit <n>", "page size", "50")
    .option("--offset <n>", "page offset", "0")
    .action((options: { limit?: string; offset?: string }, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalOptions;
      const queue = connect(globals);
      const dead = queue.deadLetters(
        options.limit ? Number(options.limit) : undefined,
        options.offset ? Number(options.offset) : undefined,
      );
      if (globals.json) {
        printJson(dead);
        return;
      }
      printTable(
        dead.map((entry) => ({
          id: entry.id,
          task: entry.taskName,
          queue: entry.queue,
          error: entry.error ?? "",
        })),
      );
    });

  dlq
    .command("retry <deadId>")
    .description("Re-enqueue a dead-letter entry")
    .action((deadId: string, _options: unknown, command: Command) => {
      const queue = connect(command.optsWithGlobals() as GlobalOptions);
      printJson({ id: queue.retryDead(deadId) });
    });

  dlq
    .command("delete <deadId>")
    .description("Delete a dead-letter entry")
    .action((deadId: string, _options: unknown, command: Command) => {
      const queue = connect(command.optsWithGlobals() as GlobalOptions);
      printJson({ deleted: queue.deleteDead(deadId) });
    });

  dlq
    .command("purge")
    .description("Purge dead-letter entries older than a cutoff")
    .option("--older-than-ms <n>", "age cutoff in ms", "0")
    .action((options: { olderThanMs?: string }, command: Command) => {
      const queue = connect(command.optsWithGlobals() as GlobalOptions);
      printJson({ purged: queue.purgeDead(Number(options.olderThanMs ?? 0)) });
    });
}
