import { Queue, type QueueOptions } from "../index";
import { positiveIntFlag } from "./parse";

/** Global connection options shared by every CLI command. */
export interface GlobalOptions {
  db?: string;
  backend?: string;
  dsn?: string;
  poolSize?: string;
  schema?: string;
  prefix?: string;
  namespace?: string;
  json?: boolean;
}

/** Build a {@link Queue} from the CLI's global connection options. */
export function connect(options: GlobalOptions): Queue {
  const queueOptions: QueueOptions = {
    dbPath: options.db,
    backend: options.backend as QueueOptions["backend"],
    dsn: options.dsn,
    poolSize: positiveIntFlag(options.poolSize, "pool-size"),
    schema: options.schema,
    prefix: options.prefix,
    namespace: options.namespace,
  };
  return new Queue(queueOptions);
}
