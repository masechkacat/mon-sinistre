import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as tar from 'tar';

/**
 * The directory every DILA delta wraps its tree in, named after the delta's
 * generation timestamp — so an archive path is
 * `20260613-002012/jorf/simple/JORF/CONT/…`, never `jorf/…` on its own
 * (`DilaClient`'s path filter has to see through it).
 */
export const TARBALL_ROOT_DIR = '20260613-002012';

/**
 * Packs `files` (keyed by their path below {@link TARBALL_ROOT_DIR}, e.g.
 * `jorf/simple/JORF/CONT/2026/06/13/JORFTEXT000054245373.xml`) into an
 * in-memory `tar.gz`, the shape every DILA delta fixture needs — shared by
 * `dila.client.spec.ts` and `jorf-monitor.int-spec.ts` so neither keeps its
 * own copy of the packing step.
 */
export async function buildTarball(
  files: Record<string, string>,
): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'dila-tarball-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      const filePath = join(dir, TARBALL_ROOT_DIR, path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }
    const pack = tar.create({ gzip: true, cwd: dir }, [TARBALL_ROOT_DIR]);
    const chunks: Buffer[] = [];
    for await (const chunk of pack) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
