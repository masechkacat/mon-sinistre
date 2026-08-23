import { DILA_JORFSIMPLE_BASE_URL, DilaClient } from './dila.client';
import { buildTarball, TARBALL_ROOT_DIR } from 'test/helpers/build-tarball';
import { jorfFixture } from 'test/fixtures/jorf';

const indexHtml = jorfFixture('dila-index.html');
const arreteXml = jorfFixture('JORFTEXT000054245373.xml');
const tocXml = jorfFixture('JORFCONT000054245240.xml');

const fetchOf = (body: string | Uint8Array, status = 200) =>
  jest.fn(() => Promise.resolve(new Response(body, { status })));

/**
 * The same layout as a real DILA delta ({@link TARBALL_ROOT_DIR} wraps every
 * path): the two wanted XML files under `jorf/simple/JORF/CONT/…` plus decoy
 * paths that a correct client must never read — a non-XML file inside the CONT
 * tree, and an XML file under `jorf/simple/JORF/` but outside CONT.
 */
const buildDeltaTarball = (): Promise<Buffer> =>
  buildTarball({
    'jorf/simple/JORF/CONT/2026/06/13/JORFCONT000054245240.xml': tocXml,
    'jorf/simple/JORF/CONT/2026/06/13/JORFTEXT000054245373.xml': arreteXml,
    'jorf/simple/JORF/CONT/2026/06/13/notes.txt': 'not an xml file',
    'jorf/simple/JORF/OTHER/JORFTEXT999999999.xml': '<TEXTE/>',
  });

describe('DilaClient', () => {
  describe('listDeltas', () => {
    it('parses delta file names out of the saved Apache index and sorts them ascending', async () => {
      const fetchFn = fetchOf(indexHtml);

      const result = await new DilaClient(fetchFn).listDeltas();

      expect(fetchFn).toHaveBeenCalledWith(
        DILA_JORFSIMPLE_BASE_URL,
        expect.objectContaining({ signal: expect.any(AbortSignal) as unknown }),
      );
      expect(result).toEqual([
        'JORFSIMPLE_20260611-001512.tar.gz',
        'JORFSIMPLE_20260612-002012.tar.gz',
        'JORFSIMPLE_20260612-205512.tar.gz',
      ]);
    });

    it('rejects a non-2xx response', async () => {
      const client = new DilaClient(fetchOf('', 503));

      await expect(client.listDeltas()).rejects.toThrow('503');
    });

    it('propagates a network error', async () => {
      const fetchFn = jest.fn(() => Promise.reject(new Error('ECONNRESET')));

      await expect(new DilaClient(fetchFn).listDeltas()).rejects.toThrow(
        'ECONNRESET',
      );
    });
  });

  describe('downloadDelta', () => {
    it('extracts only the CONT XML files from the tarball, in memory', async () => {
      const tarball = await buildDeltaTarball();
      const fetchFn = fetchOf(new Uint8Array(tarball));

      const result = await new DilaClient(fetchFn).downloadDelta(
        'JORFSIMPLE_20260613-002012.tar.gz',
      );

      expect(fetchFn).toHaveBeenCalledWith(
        `${DILA_JORFSIMPLE_BASE_URL}JORFSIMPLE_20260613-002012.tar.gz`,
        expect.objectContaining({ signal: expect.any(AbortSignal) as unknown }),
      );
      const toc = `${TARBALL_ROOT_DIR}/jorf/simple/JORF/CONT/2026/06/13/JORFCONT000054245240.xml`;
      const arrete = `${TARBALL_ROOT_DIR}/jorf/simple/JORF/CONT/2026/06/13/JORFTEXT000054245373.xml`;
      expect([...result.keys()].sort()).toEqual([toc, arrete]);
      expect(result.get(arrete)).toBe(arreteXml);
      expect(result.get(toc)).toBe(tocXml);
    });

    it('accepts an archive without the timestamp wrapper directory', async () => {
      // DILA changed the layout once already (the wrapper appeared unannounced);
      // this is the same delta with the wrapper dropped again.
      const tarball = await buildTarball(
        { 'jorf/simple/JORF/CONT/2026/06/13/JORFCONT000054245240.xml': tocXml },
        '',
      );

      const result = await new DilaClient(
        fetchOf(new Uint8Array(tarball)),
      ).downloadDelta('JORFSIMPLE_20260613-002012.tar.gz');

      expect([...result.keys()]).toEqual([
        'jorf/simple/JORF/CONT/2026/06/13/JORFCONT000054245240.xml',
      ]);
    });

    it('rejects an intact archive none of whose entries match the CONT layout', async () => {
      // A renamed tree would otherwise look like an empty — and therefore
      // fully processed — delta, the same silent loss `strict` guards
      // against for corrupt archives.
      const tarball = await buildTarball({
        'jorf/renamed/JORF/CONT/2026/06/13/JORFCONT000054245240.xml': tocXml,
      });

      await expect(
        new DilaClient(fetchOf(new Uint8Array(tarball))).downloadDelta(
          'JORFSIMPLE_20260613-002012.tar.gz',
        ),
      ).rejects.toThrow(/layout/i);
    });

    it('rejects a non-2xx response', async () => {
      const client = new DilaClient(fetchOf('', 404));

      await expect(
        client.downloadDelta('JORFSIMPLE_20260613-002012.tar.gz'),
      ).rejects.toThrow('404');
    });

    it('propagates a network error', async () => {
      const fetchFn = jest.fn(() => Promise.reject(new Error('ECONNRESET')));

      await expect(
        new DilaClient(fetchFn).downloadDelta(
          'JORFSIMPLE_20260613-002012.tar.gz',
        ),
      ).rejects.toThrow('ECONNRESET');
    });

    it('rejects an HTTP 200 whose body is not a tarball at all', async () => {
      // DILA serving an error page under HTTP 200: a non-strict tar parser
      // reports it as a warning and ends normally, which would look like an
      // empty — and therefore fully processed — delta.
      const client = new DilaClient(
        fetchOf('<html>503 Service Unavailable</html>'),
      );

      await expect(
        client.downloadDelta('JORFSIMPLE_20260613-002012.tar.gz'),
      ).rejects.toThrow(/archive/i);
    });

    it('propagates a body stream that fails mid-transfer', async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0x1f, 0x8b]));
          setTimeout(() => controller.error(new Error('connection reset')), 0);
        },
      });
      const fetchFn = jest.fn(() =>
        Promise.resolve(new Response(body, { status: 200 })),
      );

      await expect(
        new DilaClient(fetchFn).downloadDelta(
          'JORFSIMPLE_20260613-002012.tar.gz',
        ),
      ).rejects.toThrow('connection reset');
    });
  });
});
