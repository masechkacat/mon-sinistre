import { Global, Module } from '@nestjs/common';
import { DeadlineRuleService } from './deadline-rule.service';

/**
 * Global like `PrismaModule`/`MailModule`: resolving a `DeadlineRule` is
 * cross-cutting reference-data access, not a feature with its own routes,
 * and `src/sinistres/` (next issue of this phase) needs it too.
 */
@Global()
@Module({
  providers: [DeadlineRuleService],
  exports: [DeadlineRuleService],
})
export class DeadlineRulesModule {}
