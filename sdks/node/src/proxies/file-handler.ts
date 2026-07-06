import { existsSync, realpathSync } from "node:fs";
import { dirname, normalize, relative, resolve, sep } from "node:path";
import { ProxyError } from "../errors";
import type { ProxyHandler } from "./types";

/** A file identified by path — the value type {@link FileProxyHandler} proxies. */
export class FileReference {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }
}

/**
 * Proxies a {@link FileReference} by its absolute path. An optional allowlist
 * of root directories is enforced on reconstruct, so a tampered or hostile
 * ref cannot resolve to a path outside them (an empty allowlist permits any
 * path). Roots and candidate paths are compared by their real (symlink-
 * resolved) locations.
 */
export class FileProxyHandler implements ProxyHandler<FileReference> {
  readonly id = "file";
  private readonly allowedRoots: readonly string[];

  constructor(allowedRoots: readonly string[] = []) {
    // Resolve each root to its real path so containment is checked against
    // the true filesystem location, not a symlinked alias.
    this.allowedRoots = allowedRoots.map((root) => realPath(resolve(root)));
  }

  handles(value: unknown): boolean {
    return value instanceof FileReference;
  }

  deconstruct(value: FileReference): Record<string, unknown> {
    return { path: resolve(value.path) };
  }

  reconstruct(reference: Record<string, unknown>): FileReference {
    const path = reference.path;
    if (typeof path !== "string") {
      throw new ProxyError('file proxy ref missing "path"');
    }
    const resolved = normalize(resolve(path));
    if (!this.allowed(resolved)) {
      throw new ProxyError(`file path not in allowlist: ${resolved}`);
    }
    return new FileReference(resolved);
  }

  private allowed(path: string): boolean {
    if (this.allowedRoots.length === 0) {
      return true;
    }
    const real = realPath(path);
    return this.allowedRoots.some((root) => real === root || real.startsWith(root + sep));
  }
}

/**
 * The real (symlink-resolved) path. Since the target may not exist yet,
 * resolve the nearest existing ancestor to its real path — collapsing any
 * symlinked ancestor — then re-append the remaining segments. A path whose
 * ancestors do not exist yet has no symlink to hide behind, so its normalized
 * form stands.
 */
function realPath(path: string): string {
  let existing = path;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      return normalize(path);
    }
    existing = parent;
  }
  try {
    const realExisting = realpathSync(existing);
    return normalize(resolve(realExisting, relative(existing, path)));
  } catch (error) {
    throw new ProxyError(`failed to resolve real path for ${path} (${String(error)})`);
  }
}
