import { once } from "node:events";
import type { Command } from "commander";
import { serveDashboard } from "../../dashboard";
import { connect, type GlobalOptions } from "../connect";
import { positiveIntFlag } from "../parse";

export function registerDashboard(program: Command): void {
  program
    .command("dashboard")
    .description("Serve the web dashboard")
    .option("-p, --port <n>", "port to listen on", "8787")
    .option("--host <host>", "host to bind", "127.0.0.1")
    .action(async (options: { port?: string; host?: string }, command: Command) => {
      const queue = connect(command.optsWithGlobals() as GlobalOptions);
      const host = options.host ?? "127.0.0.1";
      const port = positiveIntFlag(options.port, "port") ?? 8787;
      if (port > 65535) {
        throw new Error(`--port must be <= 65535, got ${port}`);
      }
      const server = serveDashboard(queue, { port, host });
      // Confirm the bind succeeded before reporting success (e.g. port in use).
      await Promise.race([
        once(server, "listening"),
        once(server, "error").then(([error]) => {
          throw error;
        }),
      ]);
      process.stdout.write(`taskito dashboard on http://${host}:${port}\n`);
    });
}
