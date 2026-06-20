import type { Command } from "commander";
import { serveDashboard } from "../../dashboard";
import { connect, type GlobalOptions } from "../connect";

export function registerDashboard(program: Command): void {
  program
    .command("dashboard")
    .description("Serve the web dashboard")
    .option("-p, --port <n>", "port to listen on", "8787")
    .option("--host <host>", "host to bind", "127.0.0.1")
    .action((options: { port?: string; host?: string }, command: Command) => {
      const queue = connect(command.optsWithGlobals() as GlobalOptions);
      const host = options.host ?? "127.0.0.1";
      const port = options.port ? Number(options.port) : 8787;
      serveDashboard(queue, { port, host });
      process.stdout.write(`taskito dashboard on http://${host}:${port}\n`);
    });
}
