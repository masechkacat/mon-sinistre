import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import {
  ACCOUNT_CONFIRM_TTL_DAYS,
  type AccountConfirmationStatus,
} from '@mon-sinistre/contracts';
import { generateSecureToken, hashSecureToken } from 'src/common/secure-token';
import { addDays } from 'src/common/time';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { MailService } from 'src/mail/mail.service';
import { isUniqueViolationOn } from 'src/prisma/prisma-error';
import { PrismaService } from 'src/prisma/prisma.service';
import { confirmationMailFor } from './account-confirmation-mail';
import type { RegisterDto } from './dto/register.dto';

const nextConfirmExpiresAt = (): Date => addDays(ACCOUNT_CONFIRM_TTL_DAYS);

@Injectable()
export class AuthService {
  private readonly saltRounds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.saltRounds = config.get('SALT_ROUNDS', { infer: true });
  }

  /**
   * Anti-enumeration (PRD, «Ограничения»): whatever the address turns out to
   * be, this resolves without throwing. An address already in `User` — the
   * only constraint a caller-supplied value can violate here, the token hash
   * being 256 random bits apart (`isUniqueViolationOn`, not the global Prisma
   * mapping: a 409 here would tell a caller the address is already
   * registered) — is left untouched: rewriting an unconfirmed account's
   * password and re-mailing it, or mailing a confirmed one its "vous avez
   * déjà un compte" link, is docs/plan/user-account.md phase 3. This issue
   * only guarantees the row stays unique and the caller never sees an error
   * either way. Response *timing* still differs between the two branches
   * (the new-address branch additionally awaits `mail.send()`) until phase 3
   * gives the duplicate branch mail of its own to send — CLAUDE.md, «Anti-
   * enumeration: временная асимметрия по времени ответа».
   */
  async register(dto: RegisterDto): Promise<void> {
    const passwordHash = await bcrypt.hash(dto.password, this.saltRounds);
    const confirm = generateSecureToken();

    try {
      await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          confirmTokenHash: confirm.hash,
          confirmExpiresAt: nextConfirmExpiresAt(),
        },
      });
    } catch (error) {
      if (isUniqueViolationOn(error, 'email')) return;
      throw error;
    }

    // Sent after the row is written: a delivery failure must not undo an
    // account the caller will otherwise never see again.
    await this.mail.send(confirmationMailFor(dto.email, confirm.token));
  }

  /**
   * One conditional `updateMany`, not read-then-update — same reason as
   * veille's `VeilleService.confirm`: a concurrent call with the same token
   * must answer "confirmed" too, not throw `P2025` the way a plain `update`
   * would once the first call already won the race. `confirmTokenHash` is
   * never cleared on activation, so a repeat call still finds the row and
   * answers "confirmed" regardless of `confirmExpiresAt` — an already-active
   * account never expires back to "invalid".
   */
  async confirm(token: string): Promise<AccountConfirmationStatus> {
    const tokenHash = hashSecureToken(token);
    const activated = await this.prisma.user.updateMany({
      where: {
        confirmTokenHash: tokenHash,
        confirmedAt: null,
        confirmExpiresAt: { gte: new Date() },
      },
      data: { confirmedAt: new Date() },
    });
    if (activated.count > 0) return 'confirmed';

    const user = await this.prisma.user.findUnique({
      where: { confirmTokenHash: tokenHash },
      select: { confirmedAt: true },
    });
    return user?.confirmedAt ? 'confirmed' : 'invalid';
  }
}
