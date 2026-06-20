import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import type { Worker } from "../../index";

interface RunOptions {
  queues?: string;
  batchSize?: string;
}

/** The minimal surface `run` needs from a user's app module. */
interface WorkerApp {
  runWorker(options?: { queues?: string[]; batchSize?: number }): Worker;
}

export function registerRun(program: Command): void {
  program
    .command("run <app>")
    .description(
      "Run a worker. <app> is a module exporting a configured Queue (default export or `queue`).",
    )
    .option("--queues <list>", "comma-separated queue names")
    .option("--batch-size <n>", "jobs claimed per poll")
    .action(async (appPath: string, options: RunOptions) => {
      const app = await loadApp(appPath);
      const queues = options.queues ? options.queues.split(",") : undefined;
      const worker = app.runWorker({
        queues,
        batchSize: options.batchSize ? Number(options.batchSize) : undefined,
      });

      process.stdout.write(
        `taskito worker running (queues: ${queues?.join(",") ?? "default"}) — Ctrl-C to stop\n`,
      );
      const stop = () => {
        worker.stop();
        process.exit(0);
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      await new Promise<never>(() => {});
    });
}

/** Import the user's app module and return its configured queue. */
async function loadApp(appPath: string): Promise<WorkerApp> {
  const module = (await import(pathToFileURL(resolve(appPath)).href)) as Record<string, unknown>;
  const candidate = module.default ?? module.queue;
  if (!candidate || typeof (candidate as WorkerApp).runWorker !== "function") {
    throw new Error(`module "${appPath}" must export a Queue (default export or \`queue\`)`);
  }
  return candidate as WorkerApp;
}
