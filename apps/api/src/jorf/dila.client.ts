import { Readable } from 'node:stream';
import { Parser as TarParser, ReadEntry } from 'tar';
import type { FetchFn } from 'src/common/fetch-fn';

/**
 * Client for the DILA JORFSIMPLE open-data feed — the monitor's only data
 * source (decision: docs/research/jorf-monitor.md, "Источник данных").
 * A plain class, not a Nest provider: the backfill script (phase 4)
 * instantiates it without an application context, same as `GeoApiClient`.
 */

export const DILA_JORFSIMPLE_BASE_URL =
  'https://echanges.dila.gouv.fr/OPENDATA/JORFSIMPLE/';

/** Delta names double as their generation timestamp, so ascending name order is chronological order. */
const DELTA_NAME_PATTERN = /JORFSIMPLE_\d{8}-\d{6}\.tar\.gz/g;

/**
 * Only the issue table-of-contents and text files matter to the monitor —
 * everything else in the tarball is discarded unread. The leading directory
 * is the delta's own timestamp (`20260613-002012/jorf/simple/JORF/CONT/…`):
 * DILA wraps every archive in it, so anchoring on `jorf/` matches nothing at
 * all and the delta silently yields zero files.
 */
const CONT_XML_PATH_PATTERN =
  /^\d{8}-\d{6}\/jorf\/simple\/JORF\/CONT\/.*\.xml$/;

const LISTING_TIMEOUT_MS = 60_000;

/** Deltas observed between 28 KB and 18 MB (docs/research/jorf-monitor.md). */
const DELTA_TIMEOUT_MS = 120_000;

async function readEntryText(entry: ReadEntry): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of entry) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export class DilaClient {
  constructor(private readonly fetchFn: FetchFn = globalThis.fetch) {}

  /** Delta file names found in the Apache index of the JORFSIMPLE directory, deduplicated and sorted ascending. */
  async listDeltas(): Promise<string[]> {
    const response = await this.fetchFn(DILA_JORFSIMPLE_BASE_URL, {
      signal: AbortSignal.timeout(LISTING_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`DILA listing responded with HTTP ${response.status}`);
    }
    const html = await response.text();
    const names = new Set(html.match(DELTA_NAME_PATTERN) ?? []);
    return [...names].sort();
  }

  /**
   * Downloads one delta and streams the `tar.gz` straight into memory,
   * returning only the `jorf/simple/JORF/CONT/**\/*.xml` entries (issue
   * table-of-contents and text files) keyed by their path in the archive.
   */
  async downloadDelta(fileName: string): Promise<Map<string, string>> {
    const response = await this.fetchFn(
      `${DILA_JORFSIMPLE_BASE_URL}${fileName}`,
      { signal: AbortSignal.timeout(DELTA_TIMEOUT_MS) },
    );
    if (!response.ok) {
      throw new Error(
        `DILA delta ${fileName} responded with HTTP ${response.status}`,
      );
    }
    if (!response.body) {
      throw new Error(`DILA delta ${fileName} response has no body`);
    }

    const files = new Map<string, string>();
    const reads: Promise<void>[] = [];
    const parser = new TarParser({
      // Without `strict`, node-tar reports a corrupt archive as a `'warn'`
      // event and still emits `'end'`: an error page served with HTTP 200
      // would come back as zero entries, and the caller would mark the delta
      // processed forever instead of retrying it.
      strict: true,
      filter: (path) => CONT_XML_PATH_PATTERN.test(path),
      onReadEntry: (entry) => {
        reads.push(
          readEntryText(entry).then((content) => {
            files.set(entry.path, content);
          }),
        );
      },
    });

    // `.pipe()` does not forward the source's `'error'` event to the
    // destination, so a mid-stream network failure must be caught on the
    // source itself — otherwise it throws uncaught instead of rejecting.
    const source = Readable.fromWeb(response.body);
    try {
      await new Promise<void>((resolve, reject) => {
        source.on('error', reject);
        parser.on('error', reject);
        parser.on('end', resolve);
        source.pipe(parser);
      });
      await Promise.all(reads);
    } catch (error) {
      source.destroy();
      // Entries already being read keep going after the rejection; leaving
      // those promises unobserved would crash the process with an
      // unhandledRejection instead of surfacing the failure below.
      await Promise.allSettled(reads);
      throw error;
    }
    return files;
  }
}
