import {
  Injectable,
  SetMetadata,
  type CustomDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

const THROTTLE_BY_TOKEN = 'throttle-by-token';

/**
 * Считать лимит маршрута по токену из тела запроса, а не по IP. Нужно там, где
 * запрос приходит не от пользователя напрямую: у one-click отписки (RFC 8058)
 * между почтовым клиентом и API стоит route handler веб-приложения, поэтому по
 * IP весь поток отписок неотличим от одного клиента и упирается в общий лимит
 * все вместе. Токен же у каждой подписки свой.
 */
export const ThrottleByToken = (): CustomDecorator =>
  SetMetadata(THROTTLE_BY_TOKEN, true);

@Injectable()
export class TokenThrottlerGuard extends ThrottlerGuard {
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const byToken = this.reflector.getAllAndOverride<boolean>(
      THROTTLE_BY_TOKEN,
      [context.getHandler(), context.getClass()],
    );
    if (!byToken) return super.generateKey(context, suffix, name);

    const { body } = context
      .switchToHttp()
      .getRequest<{ body?: { token?: unknown } }>();
    const token = typeof body?.token === 'string' ? body.token : '';
    // Ключ строит super, а не этот метод: он сворачивает suffix в хеш, и токен
    // не оседает в счётчике открытым. Пустой токен — назад к IP: запросы без
    // токена иначе делили бы одну корзину на всех.
    return super.generateKey(context, token || suffix, name);
  }
}
