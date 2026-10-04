import { IsBoolean } from 'class-validator';
import type { RemindersPreference } from '@mon-sinistre/contracts';

/** Body **and** response of `PATCH /rappels` — the contract has one shape for
 * both, so one class carries the validation and the Swagger schema. */
export class RemindersPreferenceDto implements RemindersPreference {
  @IsBoolean()
  enabled: boolean;
}
