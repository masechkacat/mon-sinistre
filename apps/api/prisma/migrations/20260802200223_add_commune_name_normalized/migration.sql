-- AlterTable
--
-- Поисковый ключ названия коммуны: его пишет normalizeCommuneName при импорте,
-- по нему же идут WHERE и ORDER BY поиска.
--
-- Nullable осознанно: у строк, импортированных до этой миграции, ключа ещё
-- нет. Backfill — перезапуск идемпотентного импорта (`npm run seed`), правило
-- нормализации на SQL не повторяется (docs/research/commune-referential.md);
-- ужесточение до NOT NULL — отдельной миграцией после backfill'а.
--
-- COLLATE "C" — не оптимизация, а переносимость. Нормализация снимает регистр
-- и диакритику, но не пунктуацию, а расходятся collation'ы именно на ней:
-- glibc игнорирует дефис на первичном уровне сравнения, musl и ICU учитывают.
-- Проверено 02.08.2026 на обоих образах: «Saint-Étienne» и «Sainte-Marie»
-- меняются местами между postgres:18 (glibc) и postgres:18-alpine (musl).
-- Порядок выдачи поиска не должен зависеть от того, где развёрнута база.
--
-- Prisma collation не выражает и обратно из базы не читает: она живёт только
-- здесь, дрейфом не считается, сторожит её commune-name-normalized.int-spec.
ALTER TABLE "Commune" ADD COLUMN "nameNormalized" TEXT COLLATE "C";

-- CreateIndex
--
-- Обычный btree: под COLLATE "C" он обслуживает и префиксный LIKE 'q%', и
-- ORDER BY, поэтому класс оператора text_pattern_ops не нужен (он понадобился
-- бы под локальной collation). Имя — дефолтное для @@index([nameNormalized])
-- в schema.prisma, иначе следующий migrate dev переименовал бы индекс за нас.
CREATE INDEX "Commune_nameNormalized_idx" ON "Commune" ("nameNormalized");
