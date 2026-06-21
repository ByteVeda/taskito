import type { Command } from "commander";
import { serveScaler } from "../../scaler";
import { connect, type GlobalOptions } from "../connect";

export function registerScaler(program: Command): void {
  program
    .command("scaler")
    .description("Serve the KEDA scaler endpoint (queue-depth metric)")
    .option("-p, --port <n>", "port to listen on", "9091")
    .option("--host <host>", "host to bind", "0.0.0.0")
    .option("--target-queue-depth <n>", "target queue depth per replica", "10")
    .option("--queue <name>", "restrict the metric to one queue")
    .action(
      (
        options: { port?: string; host?: string; targetQueueDepth?: string; queue?: string },
        command: Command,
      ) => {
        const queue = connect(command.optsWithGlobals() as GlobalOptions);
        const host = options.host ?? "0.0.0.0";
        const port = options.port ? Number(options.port) : 9091;
        serveScaler(queue, {
          port,
          host,
          targetQueueDepth: options.targetQueueDepth ? Number(options.targetQueueDepth) : undefined,
          queue: options.queue,
        });
        process.stdout.write(`taskito scaler on http://${host}:${port}/api/scaler\n`);
      },
    );
}
