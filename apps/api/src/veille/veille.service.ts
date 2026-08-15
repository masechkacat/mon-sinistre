import { BadRequestException, Injectable } from '@nestjs/common';
import {
  VEILLE_CONFIRM_TTL_DAYS,
  VEILLE_UNSUBSCRIBE_PATH,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { Prisma } from 'src/generated/prisma/client';
import type { ComposeMailInput } from 'src/mail/mail-message';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import type { CreateVeilleDto } from './dto/create-veille.dto';
import { generateVeilleToken } from './veille-token';

const DAY_MS = 24 * 60 * 60 * 1000;

interface ChosenCommune {
  readonly name: string;
  readonly departementName: string;
}

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
      await this.prisma.$transaction((tx) =>
        tx.veille.create({
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
        }),
      );
    } catch (error) {
      if (isDuplicateEmail(error)) return;
      throw error;
    }

    // Sent after the transaction commits: a delivery failure must not roll
    // back a subscription the caller will otherwise never see again.
    await this.mail.send(
      confirmationMailFor(
        dto.email,
        communes,
        confirm.token,
        unsubscribe.token,
      ),
    );
  }
}

/**
 * P2002 on `unique(email)` — the only constraint a caller-supplied value can
 * violate here (the token hashes are 256 random bits apart). Not translated
 * by the global mapping on purpose (`src/prisma/prisma-error.ts`): a 409 on
 * this endpoint would tell an attacker the address is already registered.
 */
const isDuplicateEmail = (error: unknown): boolean => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes('email')
    : typeof target === 'string' && target.includes('email');
};

const confirmationMailFor = (
  to: string,
  communes: readonly ChosenCommune[],
  confirmToken: string,
  unsubscribeToken: string,
): ComposeMailInput => ({
  to,
  subject: fr.mail.veille.confirmation.subject,
  reason: fr.mail.veille.reason,
  unsubscribePath: `${VEILLE_UNSUBSCRIBE_PATH}?token=${unsubscribeToken}`,
  blocks: [
    { kind: 'paragraph', text: fr.mail.veille.confirmation.intro },
    {
      kind: 'list',
      items: communes.map((c) => `${c.name} (${c.departementName})`),
    },
    {
      kind: 'link',
      text: fr.mail.veille.confirmation.confirmLink,
      path: `/veille/confirmation?token=${confirmToken}`,
    },
    {
      kind: 'paragraph',
      text: fr.mail.veille.confirmation.expiresIn(
        String(VEILLE_CONFIRM_TTL_DAYS),
      ),
    },
  ],
});
