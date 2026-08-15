import { BadRequestException, Injectable } from '@nestjs/common';
import {
  VEILLE_CONFIRM_TTL_DAYS,
  type VeilleConfirmationStatus,
} from '@mon-sinistre/contracts';
import { MailService } from 'src/mail/mail.service';
import { isUniqueViolationOn } from 'src/prisma/prisma-error';
import { PrismaService } from 'src/prisma/prisma.service';
import type { CreateVeilleDto } from './dto/create-veille.dto';
import { confirmationMailFor } from './veille-confirmation-mail';
import { generateVeilleToken, hashVeilleToken } from './veille-token';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Single source of the pending/active/invalid decision — read by `GET` and
 * the pre-write check of `POST`, so the two never disagree on the same token.
 */
const classifyConfirmation = (
  veille: { confirmedAt: Date | null; confirmExpiresAt: Date } | null,
): VeilleConfirmationStatus => {
  if (!veille) return 'invalid';
  if (veille.confirmedAt) return 'active';
  if (veille.confirmExpiresAt < new Date()) return 'invalid';
  return 'pending';
};

@Injectable()
export class VeilleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Only the "address does not exist yet" branch of
   * docs/research/veille-subscription-lifecycle.md — the other two
   * (unconfirmed resubmission, already-subscribed) arrive in phase 3. Until
   * then a second POST for an email already in `Veille` hits the unique index
   * and is swallowed here: the caller gets the same 204 as a fresh address,
   * and the database keeps the first submission's subscription untouched.
   */
  async subscribe(dto: CreateVeilleDto): Promise<void> {
    const communeCodes = [...new Set(dto.communeCodes)];
    const communes = await this.prisma.commune.findMany({
      where: { codeInsee: { in: communeCodes }, effectiveTo: null },
      select: { codeInsee: true, name: true, departementName: true },
    });
    // Checked against the deduplicated count: a code repeated in the form
    // must not read as an unknown one.
    if (communes.length !== communeCodes.length) {
      throw new BadRequestException('Unknown commune code');
    }

    const confirm = generateVeilleToken();
    const unsubscribe = generateVeilleToken();

    try {
      // A nested create is one transaction on its own — the subscription and
      // its communes appear together or not at all.
      await this.prisma.veille.create({
        data: {
          email: dto.email,
          confirmTokenHash: confirm.hash,
          unsubscribeTokenHash: unsubscribe.hash,
          confirmExpiresAt: new Date(
            Date.now() + VEILLE_CONFIRM_TTL_DAYS * DAY_MS,
          ),
          communes: {
            create: communeCodes.map((codeInsee) => ({ codeInsee })),
          },
        },
      });
    } catch (error) {
      // The only constraint a caller-supplied value can violate here (the token
      // hashes are 256 random bits apart). Left untranslated by the global
      // Prisma mapping on purpose (`src/prisma/prisma-error.ts`): a 409 on this
      // endpoint would tell an attacker the address is already registered.
      if (isUniqueViolationOn(error, 'email')) return;
      throw error;
    }

    // Sent after the row is written: a delivery failure must not undo a
    // subscription the caller will otherwise never see again.
    await this.mail.send(
      confirmationMailFor(
        dto.email,
        communes,
        confirm.token,
        unsubscribe.token,
      ),
    );
  }

  async getConfirmationStatus(
    token: string,
  ): Promise<VeilleConfirmationStatus> {
    const veille = await this.prisma.veille.findUnique({
      where: { confirmTokenHash: hashVeilleToken(token) },
      select: { confirmedAt: true, confirmExpiresAt: true },
    });
    return classifyConfirmation(veille);
  }

  async confirm(token: string): Promise<VeilleConfirmationStatus> {
    const hash = hashVeilleToken(token);
    const veille = await this.prisma.veille.findUnique({
      where: { confirmTokenHash: hash },
      select: { confirmedAt: true, confirmExpiresAt: true },
    });
    const status = classifyConfirmation(veille);
    if (status !== 'pending') return status;

    await this.prisma.veille.update({
      where: { confirmTokenHash: hash },
      data: { confirmedAt: new Date() },
    });
    return 'active';
  }

  /**
   * `deleteMany`, not `delete`: a token matching no row must not throw — a
   * repeat call and a call on an already-deleted subscription are both a
   * silent no-op.
   */
  async unsubscribe(token: string): Promise<void> {
    await this.prisma.veille.deleteMany({
      where: { unsubscribeTokenHash: hashVeilleToken(token) },
    });
  }
}
