// Typed loader for the napi-rs binding. The generated `native/index.js` is
// CommonJS (see native/package.json), so it is loaded via createRequire rather
// than a static import.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const binding = require("../native/index.js") as typeof import("../native/index.js");

export const { JsQueue, JsWorker } = binding;

/** Instance types of the native classes, for typing fields and parameters. */
export type NativeQueue = InstanceType<typeof JsQueue>;
export type NativeWorker = InstanceType<typeof JsWorker>;

export type {
  EnqueueOptions,
  JsJob,
  JsTaskInvocation,
  WorkerOptions,
} from "../native/index.js";
