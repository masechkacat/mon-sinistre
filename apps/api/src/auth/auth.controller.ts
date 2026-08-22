import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AccountConfirmationResponse } from '@mon-sinistre/contracts';
import { AuthService } from './auth.service';
import { AccountConfirmationResponseDto } from './dto/account-confirmation-response.dto';
import { AccountTokenDto } from './dto/account-token.dto';
import { RegisterDto } from './dto/register.dto';

/** Public — no authentication: anyone may attempt to register. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Body validation (email, password policy) answers 400 in the usual ' +
      'way. Once validated, the response is 204 whatever the address turns ' +
      'out to be — anti-enumeration, docs/prd/user-account.md.',
  })
  @ApiNoContentResponse()
  async register(@Body() dto: RegisterDto): Promise<void> {
    await this.auth.register(dto);
  }

  @Post('confirmation')
  // Overridden for the same reason as veille's confirmation POST.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activate an account from its confirmation link',
    description:
      'Mutates — visiting the link itself (GET, e.g. a mail client preview) ' +
      'never activates an account, only this POST does. Sets confirmedAt. A ' +
      'second call with the same token is not an error — it answers ' +
      '"confirmed" again. An unknown or expired token answers "invalid", ' +
      'the cause not told apart.',
  })
  @ApiOkResponse({ type: AccountConfirmationResponseDto })
  async confirm(
    @Body() body: AccountTokenDto,
  ): Promise<AccountConfirmationResponse> {
    return { status: await this.auth.confirm(body.token) };
  }
}
