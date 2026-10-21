import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { RisqueCatnat } from '@mon-sinistre/contracts';
import { PrismaService } from 'src/prisma/prisma.service.js';
import { seedDeadlineRules } from 'src/deadline-rules/deadline-rule.seed.js';
import { seedStepTemplates } from 'src/step-templates/step-template.seed.js';
import { createIntTestApp } from 'test/helpers/app.js';
import { commune } from 'test/helpers/commune.js';

it('control: dossier client reaches the public API', async () => {
  const app = await createIntTestApp();
  try {
    const prisma = app.get(PrismaService);
    await prisma.commune.upsert({
      where: { codeInsee: '30189' },
      create: commune('30189', 'Nîmes', '30', 'Gard'),
      update: {},
    });
    await seedDeadlineRules(prisma);
    await seedStepTemplates(prisma);
    await app.listen(0, '127.0.0.1');
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', path.resolve('../web/control-client.ts')],
      {
        env: { ...process.env, NEXT_PUBLIC_API_URL: await app.getUrl() },
        timeout: 15_000,
      },
    );
    const result: unknown = JSON.parse(stdout);
    expect(result).toMatchObject({
      commune: { codeInsee: '30189' },
      risque: RisqueCatnat.INONDATION,
      eventDate: '2026-06-10',
    });
  } finally {
    await app.close();
  }
});
