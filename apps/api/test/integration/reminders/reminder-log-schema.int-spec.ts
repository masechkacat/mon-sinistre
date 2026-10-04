import { PrismaClient, ReminderKind } from 'src/generated/prisma/client';
import { createIntTestPrismaClient } from 'test/helpers/prisma-client';
import { createSinistre } from 'test/helpers/sinistre';
import { userData } from 'test/helpers/user-data';

// Schema-level guarantees of the add_reminder_log migration:
// docs/research/data-model.md § 5, § 6, docs/research/sinistre-reminders.md,
// «Схема: ReminderLog по data-model § 6».
describe('ReminderLog schema (integration)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createIntTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune" CASCADE`;
  });

  const PLANNED_DATE = new Date('2026-07-15');

  async function createStep() {
    const { user, sinistre } = await createSinistre(prisma);
    const step = await prisma.step.create({
      data: {
        sinistreId: sinistre.id,
        name: 'Déclarer le sinistre',
        description: 'À l’assureur',
        anchor: 'DATE_SINISTRE',
        offsetDays: 30,
        plannedDate: PLANNED_DATE,
        fromTemplate: true,
        order: 1,
      },
    });
    return { user, sinistre, step };
  }

  const logRow = (
    stepId: string,
    overrides: {
      kind?: ReminderKind;
      offsetDays?: number | null;
      plannedDate?: Date;
      sentOn: string;
    },
  ) => ({
    stepId,
    kind: overrides.kind ?? 'SCALE',
    offsetDays: overrides.offsetDays ?? 14,
    plannedDate: overrides.plannedDate ?? PLANNED_DATE,
    sentOn: new Date(overrides.sentOn),
  });

  const overdueRow = (stepId: string, sentOn: string, plannedDate?: Date) =>
    logRow(stepId, {
      kind: 'OVERDUE',
      offsetDays: null,
      plannedDate,
      sentOn,
    });

  it('rejects a second SCALE row for the same (step, offsetDays, plannedDate)', async () => {
    const { step } = await createStep();
    await prisma.reminderLog.create({
      data: logRow(step.id, { sentOn: '2026-07-01' }),
    });

    await expect(
      prisma.reminderLog.create({
        data: logRow(step.id, { sentOn: '2026-07-02' }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows SCALE rows of the same step for another threshold and for another plannedDate', async () => {
    const { step } = await createStep();
    await prisma.reminderLog.create({
      data: logRow(step.id, { sentOn: '2026-07-01' }),
    });

    await expect(
      prisma.reminderLog.create({
        data: logRow(step.id, { offsetDays: 3, sentOn: '2026-07-12' }),
      }),
    ).resolves.toMatchObject({ offsetDays: 3 });

    await expect(
      prisma.reminderLog.create({
        data: logRow(step.id, {
          plannedDate: new Date('2026-08-01'),
          sentOn: '2026-07-18',
        }),
      }),
    ).resolves.toMatchObject({ offsetDays: 14 });
  });

  it('rejects a second OVERDUE row for the same (step, sentOn)', async () => {
    const { step } = await createStep();
    await prisma.reminderLog.create({
      data: overdueRow(step.id, '2026-07-16'),
    });

    await expect(
      prisma.reminderLog.create({
        // Другая plannedDate в ключ OVERDUE не входит: второе письмо о
        // просрочке в тот же день отклоняется и по новой дате шага.
        data: overdueRow(step.id, '2026-07-16', new Date('2026-08-01')),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows OVERDUE rows of the same step sent on different days', async () => {
    const { step } = await createStep();
    await prisma.reminderLog.create({
      data: overdueRow(step.id, '2026-07-16'),
    });

    await expect(
      prisma.reminderLog.create({
        data: overdueRow(step.id, '2026-07-23'),
      }),
    ).resolves.toMatchObject({ kind: 'OVERDUE' });
  });

  it('rejects the same unsubscribe token hash for a second account', async () => {
    const tokenHash = 'reminder-unsubscribe-hash';
    const first = await prisma.user.create({ data: userData() });
    const second = await prisma.user.create({ data: userData() });
    await prisma.reminderUnsubscribeToken.create({
      data: { tokenHash, userId: first.id },
    });

    await expect(
      prisma.reminderUnsubscribeToken.create({
        data: { tokenHash, userId: second.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('cascades: deleting a User removes its unsubscribe tokens', async () => {
    const user = await prisma.user.create({ data: userData() });
    await prisma.reminderUnsubscribeToken.create({
      data: { tokenHash: 'reminder-unsubscribe-hash', userId: user.id },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.reminderUnsubscribeToken.count()).toBe(0);
  });

  it('leaves reminders on for a fresh account', async () => {
    const user = await prisma.user.create({ data: userData() });

    expect(user).toMatchObject({
      remindersDisabledAt: null,
      reminderFailures: 0,
    });
  });

  it('cascades: deleting a Sinistre removes the ReminderLog rows of its steps', async () => {
    const { sinistre, step } = await createStep();
    await prisma.reminderLog.create({
      data: logRow(step.id, { sentOn: '2026-07-01' }),
    });

    await prisma.sinistre.delete({ where: { id: sinistre.id } });

    expect(
      await prisma.reminderLog.findMany({ where: { stepId: step.id } }),
    ).toEqual([]);
  });

  it('cascades: deleting a User removes the ReminderLog rows of its steps', async () => {
    const { user, step } = await createStep();
    await prisma.reminderLog.create({
      data: logRow(step.id, { sentOn: '2026-07-01' }),
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(
      await prisma.reminderLog.findMany({ where: { stepId: step.id } }),
    ).toEqual([]);
  });
});
