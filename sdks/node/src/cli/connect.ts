import { Queue, type QueueOptions } from "../index";

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
    poolSize: options.poolSize ? Number(options.poolSize) : undefined,
    schema: options.schema,
    prefix: options.prefix,
    namespace: options.namespace,
  };
  return new Queue(queueOptions);
}
