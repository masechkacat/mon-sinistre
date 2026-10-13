import { describe, it, expect, vi, type Mock } from 'vitest';
import { Logger } from '@nestjs/common';
import type { PrismaService } from 'src/prisma/prisma.service.js';
import { DeadlineRuleService } from './deadline-rule.service.js';

// resolveActiveOrNull isolates exactly one failure — the referential gap —
// and lets a failed query through: a public page answering "no deadline"
// over a dropped connection would hide the one date the product exists for.
describe('DeadlineRuleService.resolveActiveOrNull', () => {
  const onDate = new Date('2026-07-01');

  function serviceWith(findFirst: Mock) {
    const prisma = { deadlineRule: { findFirst } } as unknown as PrismaService;
    return new DeadlineRuleService(prisma);
  }

  function silentLogger() {
    const logger = new Logger('spec');
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    return { logger, error };
  }

  it('returns null and logs once when no rule is active', async () => {
    const service = serviceWith(vi.fn().mockResolvedValue(null));
    const { logger, error } = silentLogger();

    await expect(
      service.resolveActiveOrNull(
        'DECLARATION_ASSUREUR',
        'DATE_PUBLICATION_ARRETE',
        onDate,
        logger,
        'left dateless',
      ),
    ).resolves.toBeNull();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]).toEqual([
      expect.stringContaining('left dateless') as unknown,
    ]);
  });

  it('resolves once per publication date and answers null for a refusal without asking', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'rule' });
    const service = serviceWith(findFirst);
    const { logger } = silentLogger();
    const published = new Date('2026-06-12');
    const reconnu = { outcome: 'RECONNU', arrete: { publishedAt: published } };
    const refuse = { outcome: 'REFUSE', arrete: { publishedAt: published } };

    const ruleFor = await service.declarationRulesFor(
      [reconnu, reconnu, refuse],
      logger,
      'left dateless',
    );

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(ruleFor(reconnu)).toEqual({ id: 'rule' });
    expect(ruleFor(refuse)).toBeNull();
  });

  it('rethrows a failed query without logging it as a gap', async () => {
    const failure = new Error('connection reset');
    const service = serviceWith(vi.fn().mockRejectedValue(failure));
    const { logger, error } = silentLogger();

    await expect(
      service.resolveActiveOrNull(
        'DECLARATION_ASSUREUR',
        'DATE_PUBLICATION_ARRETE',
        onDate,
        logger,
        'left dateless',
      ),
    ).rejects.toBe(failure);

    expect(error).not.toHaveBeenCalled();
  });
});
