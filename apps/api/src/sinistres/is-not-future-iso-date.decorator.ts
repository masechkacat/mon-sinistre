import { registerDecorator, type ValidationArguments } from 'class-validator';
import { isIsoDate } from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';
import { todayInParis } from 'src/common/time/today-in-paris';

/**
 * Rejects a value that is not a real `YYYY-MM-DD` date, or one later than
 * today in `Europe/Paris` — the same timezone `stepStatus` reads "today"
 * from (docs/research/sinistre-plan.md, «Статусы шагов на чтении и
 * «сегодня» в Europe/Paris»), so the boundary a request hits at 23:50 Paris
 * time matches the one the plan itself uses.
 *
 * The three refusals answer with three different messages: WCAG 3.3.1 asks
 * the error to name what is actually wrong, and telling someone who typed
 * `15/06/2026` that their date is in the future sends them looking for a
 * mistake they did not make.
 */
export function IsNotFutureIsoDate(): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isNotFutureIsoDate',
      target: object.constructor,
      propertyName: propertyName as string,
      validator: {
        validate: (value: unknown): boolean =>
          typeof value === 'string' &&
          isIsoDate(value) &&
          value <= todayInParis(),
        defaultMessage: ({ value }: ValidationArguments): string => {
          if (value === undefined || value === null || value === '') {
            return fr.sinistres.eventDateRequired;
          }
          return typeof value === 'string' && isIsoDate(value)
            ? fr.sinistres.eventDateInFuture
            : fr.sinistres.eventDateInvalid;
        },
      },
    });
  };
}
