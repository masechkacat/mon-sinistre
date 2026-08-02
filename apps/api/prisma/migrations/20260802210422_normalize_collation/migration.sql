-- Поисковый ключ сортируется в байтовом порядке, а не по правилам локали.
--
-- normalizeCommuneName снимает регистр и диакритику, но не пунктуацию — а
-- расходятся collation'ы именно на ней: glibc игнорирует дефис на первичном
-- уровне сравнения, musl и ICU учитывают. Проверено 02.08.2026 на обоих
-- образах: «Saint-Étienne» и «Sainte-Marie» меняются местами между
-- postgres:18 (glibc) и postgres:18-alpine (musl). Порядок выдачи поиска не
-- должен зависеть от того, на каком образе развёрнута база.
--
-- COLLATE "C" даёт один и тот же порядок везде и, в отличие от локали,
-- позволяет обычному btree обслуживать префиксный LIKE — класс оператора
-- text_pattern_ops больше не нужен: индекс пересоздаётся обычным и работает
-- и на WHERE, и на ORDER BY. Индекс снимается до ALTER COLUMN: смена
-- collation всё равно перестроила бы его.
DROP INDEX "Commune_nameNormalized_prefix_idx";

ALTER TABLE "Commune"
  ALTER COLUMN "nameNormalized" TYPE TEXT COLLATE "C";

-- Имя — дефолтное для @@index([nameNormalized]) в schema.prisma, иначе
-- следующий migrate dev переименовал бы индекс за нас.
CREATE INDEX "Commune_nameNormalized_idx" ON "Commune" ("nameNormalized");
