import { registerDecorator } from 'class-validator';
import {
  PASSWORD_MIN_CHAR_CLASSES,
  PASSWORD_MIN_LENGTH,
  isValidPassword,
} from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr';

/**
 * Wraps `isValidPassword` (contracts, CNIL cas n° 2) as a class-validator
 * constraint: one rule and one French message shared by the registration DTO
 * and, later, the password-reset one (docs/plan/user-account.md phase 3) —
 * research, «Правила пароля», «Как применять».
 */
export function IsAccountPassword(): PropertyDecorator {
  return (object: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isAccountPassword',
      target: object.constructor,
      propertyName: propertyName as string,
      validator: {
        validate: (value: unknown): boolean =>
          typeof value === 'string' && isValidPassword(value),
        defaultMessage: (): string =>
          fr.auth.password.requirements(
            String(PASSWORD_MIN_LENGTH),
            String(PASSWORD_MIN_CHAR_CLASSES),
          ),
      },
    });
  };
}
