import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Единственный путь к реальным выгрузкам JORF, на которых стоит парсер
 * (ТЗ § 9): и юнит-спеки в `src/jorf/`, и `jorf-monitor.int-spec.ts` читают
 * их отсюда, поэтому переезд каталога правится в одном месте.
 */
export const jorfFixture = (name: string): string =>
  readFileSync(join(__dirname, 'jorf', name), 'utf-8');
