import type { Command } from "commander";
import { connect, type GlobalOptions } from "../connect";
import { printJson, printTable } from "../output";

export function registerStats(program: Command): void {
  program
    .command("stats")
    .description("Show job counts by status")
    .option("-q, --queue <name>", "limit to a single queue")
    .action((options: { queue?: string }, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalOptions;
      const queue = connect(globals);
      const stats = options.queue ? queue.statsByQueue(options.queue) : queue.stats();
      if (globals.json) {
        printJson(stats);
      } else {
        printTable([stats as unknown as Record<string, unknown>]);
      }
    });
}
