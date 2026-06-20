import type { Command } from "commander";
import { connect, type GlobalOptions } from "../connect";
import { printJson } from "../output";

export function registerCancel(program: Command): void {
  program
    .command("cancel <id>")
    .description("Cancel a pending job, or request cancellation of a running one")
    .action((id: string, _options: unknown, command: Command) => {
      const queue = connect(command.optsWithGlobals() as GlobalOptions);
      const cancelled = queue.cancelJob(id) || queue.requestCancel(id);
      printJson({ id, cancelled });
    });
}
