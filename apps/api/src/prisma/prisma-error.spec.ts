import { NotFoundException } from '@nestjs/common';
import { Prisma } from 'src/generated/prisma/client';
import {
  httpExceptionForPrisma,
  isForeignKeyViolation,
  isUniqueViolationOn,
  prismaErrorDetail,
} from './prisma-error';

/**
 * The `meta` layouts below are copied from errors raised against Postgres
 * through `@prisma/adapter-pg` 7.10 (`index`) and 7.9 (`fields`).
 */
const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`${code} for the test`, {
    code,
    clientVersion: 'test',
    meta,
  });

const uniqueViolation = (cause: Record<string, unknown>) =>
  prismaError('P2002', {
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: { kind: 'UniqueConstraintViolation', ...cause },
    },
  });

describe('isUniqueViolationOn', () => {
  describe('constraint reported by name (adapter-pg ≥ 7.10)', () => {
    it('matches the single-column unique index of the asked-for field', () => {
      const error = uniqueViolation({
        constraint: { index: 'Veille_email_key' },
        table: 'Veille',
      });
      expect(isUniqueViolationOn(error, 'email')).toBe(true);
      expect(isUniqueViolationOn(error, 'confirmTokenHash')).toBe(false);
    });

    it('takes the primary key as the asked-for field', () => {
      const error = uniqueViolation({
        constraint: { index: 'MonitorLock_pkey' },
        table: 'MonitorLock',
      });
      expect(isUniqueViolationOn(error, 'name')).toBe(true);
    });

    it('does not match a composite unique index by one of its columns', () => {
      const error = uniqueViolation({
        constraint: { index: 'VeilleNotification_veilleId_arreteId_key' },
        table: 'VeilleNotification',
      });
      expect(isUniqueViolationOn(error, 'veilleId')).toBe(false);
    });

    it('cannot match without the table name', () => {
      const error = uniqueViolation({
        constraint: { index: 'Veille_email_key' },
      });
      expect(isUniqueViolationOn(error, 'email')).toBe(false);
    });
  });

  it('falls back to the parsed columns when the name is absent', () => {
    const error = uniqueViolation({
      constraint: { fields: ['email'] },
      table: 'Veille',
    });
    expect(isUniqueViolationOn(error, 'email')).toBe(true);
    expect(isUniqueViolationOn(error, 'id')).toBe(false);
  });

  it.each([
    ['P2002 without driver detail', prismaError('P2002')],
    [
      'P2002 with the v5/v6 meta.target',
      prismaError('P2002', { target: ['email'] }),
    ],
    ['another Prisma code', prismaError('P2025')],
    ['a non-Prisma error', new Error('duplicate key value')],
  ])('is false for %s', (_label, error) => {
    expect(isUniqueViolationOn(error, 'email')).toBe(false);
  });
});

describe('isForeignKeyViolation', () => {
  it('is true for P2003 only', () => {
    expect(isForeignKeyViolation(prismaError('P2003'))).toBe(true);
    expect(isForeignKeyViolation(prismaError('P2002'))).toBe(false);
    expect(isForeignKeyViolation(new Error('P2003'))).toBe(false);
  });
});

describe('httpExceptionForPrisma', () => {
  it('maps P2025 to 404 and nothing else', () => {
    expect(httpExceptionForPrisma(prismaError('P2025'))).toBeInstanceOf(
      NotFoundException,
    );
    expect(httpExceptionForPrisma(prismaError('P2002'))).toBeUndefined();
    expect(httpExceptionForPrisma(new Error('P2025'))).toBeUndefined();
  });
});

describe('prismaErrorDetail', () => {
  it('names the code and the model, never the message or the arguments', () => {
    const detail = prismaErrorDetail(
      prismaError('P2002', { modelName: 'Veille', target: ['email'] }),
    );
    expect(detail).toBe('P2002 on Veille');
    expect(prismaErrorDetail(prismaError('P2025'))).toBe('P2025');
    expect(prismaErrorDetail(new Error('x'))).toBeUndefined();
  });
});
