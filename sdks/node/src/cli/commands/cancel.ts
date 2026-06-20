import type { Command } from "commander";
import { connect, type GlobalOptions } from "../connect";
import { printJson } from "../output";

export function registerCancel(program: Command): void {
  program
    .command("cancel <id>")
    .description("Cancel a pending job, or request cancellation of a running one")
    .action((id: string, _options: unknown, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalOptions;
      const queue = connect(globals);
      const cancelled = queue.cancelJob(id) || queue.requestCancel(id);
      if (globals.json) {
        printJson({ id, cancelled });
        return;
      }
      process.stdout.write(`${cancelled ? "cancelled" : "not cancelled"}: ${id}\n`);
    });
}
