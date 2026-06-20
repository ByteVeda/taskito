import type { Command } from "commander";
import { connect, type GlobalOptions } from "../connect";
import { printJson } from "../output";

export function registerQueues(program: Command): void {
  program
    .command("pause <queue>")
    .description("Pause a queue")
    .action((queueName: string, _options: unknown, command: Command) => {
      const queue = connect(command.optsWithGlobals() as GlobalOptions);
      queue.pauseQueue(queueName);
      printJson({ paused: queueName });
    });

  program
    .command("resume <queue>")
    .description("Resume a paused queue")
    .action((queueName: string, _options: unknown, command: Command) => {
      const queue = connect(command.optsWithGlobals() as GlobalOptions);
      queue.resumeQueue(queueName);
      printJson({ resumed: queueName });
    });

  program
    .command("paused")
    .description("List paused queues")
    .action((_options: unknown, command: Command) => {
      const queue = connect(command.optsWithGlobals() as GlobalOptions);
      printJson({ paused: queue.listPausedQueues() });
    });
}
