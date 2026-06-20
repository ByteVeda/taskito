import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterEach, expect, it } from "vitest";
import { TaskitoModule, TaskitoService } from "../../src/contrib/nest";
import { Queue, type Worker } from "../../src/index";

let worker: Worker | undefined;
let moduleRef: TestingModule | undefined;

afterEach(async () => {
  worker?.stop();
  worker = undefined;
  await moduleRef?.close();
  moduleRef = undefined;
});

function newQueue(): Queue {
  return new Queue({ dbPath: join(mkdtempSync(join(tmpdir(), "taskito-nest-")), "q.db") });
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

it("injects TaskitoService bound to the queue", async () => {
  const queue = newQueue();
  queue.task("add", (a: number, b: number) => a + b);

  moduleRef = await Test.createTestingModule({
    imports: [TaskitoModule.forRoot(queue)],
  }).compile();
  const service = moduleRef.get(TaskitoService);

  expect(service.queue).toBe(queue);

  const id = service.enqueue("add", [6, 7]);
  worker = queue.runWorker();
  expect(await waitFor(() => queue.stats().completed >= 1)).toBe(true);

  expect(await service.result(id)).toBe(13);
  expect(service.stats().completed).toBeGreaterThanOrEqual(1);
});
