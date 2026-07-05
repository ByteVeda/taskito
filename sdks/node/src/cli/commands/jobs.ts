import type { Command } from "commander";
import { connect, type GlobalOptions } from "../connect";
import { printJson, printTable } from "../output";
import { nonNegativeIntFlag } from "../parse";

interface JobsOptions {
  status?: string;
  queue?: string;
  task?: string;
  limit?: string;
  offset?: string;
}

export function registerJobs(program: Command): void {
  program
    .command("jobs")
    .description("List jobs")
    .option("--status <s>", "filter by status")
    .option("-q, --queue <q>", "filter by queue")
    .option("-t, --task <t>", "filter by task name")
    .option("--limit <n>", "page size", "50")
    .option("--offset <n>", "page offset", "0")
    .action(async (options: JobsOptions, command: Command) => {
      const globals = command.optsWithGlobals() as GlobalOptions;
      const queue = connect(globals);
      const jobs = await queue.listJobs({
        status: options.status,
        queue: options.queue,
        task: options.task,
        limit: nonNegativeIntFlag(options.limit, "limit"),
        offset: nonNegativeIntFlag(options.offset, "offset"),
      });
      if (globals.json) {
        printJson(jobs);
        return;
      }
      printTable(
        jobs.map((job) => ({
          id: job.id,
          task: job.taskName,
          queue: job.queue,
          status: job.status,
          retries: `${job.retryCount}/${job.maxRetries}`,
        })),
      );
    });
}
