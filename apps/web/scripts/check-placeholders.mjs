// Release guard: the legal pages ship as drafts whose «à compléter» markers
// the content tests assert verbatim — so with placeholders still in place
// every check stays green, and only this script can fail a deploy. npm runs
// it automatically before any future `deploy` script (npm pre-script); a
// pipeline that does not deploy via npm must call it explicitly.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const i18nDir = join(dirname(fileURLToPath(import.meta.url)), '../src/i18n');
const marker = 'à compléter';

const hits = readdirSync(i18nDir).flatMap((name) =>
  readFileSync(join(i18nDir, name), 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      line.includes(marker) ? [`src/i18n/${name}:${index + 1}`] : [],
    ),
);

if (hits.length > 0) {
  console.error(
    `Les marqueurs « ${marker} » doivent être remplis avant publication :\n` +
      hits.map((hit) => `  ${hit}`).join('\n'),
  );
  process.exit(1);
}
