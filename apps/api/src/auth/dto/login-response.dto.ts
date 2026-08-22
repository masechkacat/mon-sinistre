import { ApiProperty } from '@nestjs/swagger';
import type { LoginResponse } from '@mon-sinistre/contracts';

/**
 * Swagger-only mirror of {@link LoginResponse} — `implements` makes the
 * compiler fail here whenever the contract changes. The refresh token never
 * appears here: it goes out as an httpOnly cookie, not in the body.
 */
export class LoginResponseDto implements LoginResponse {
  @ApiProperty()
  accessToken: string;
}
