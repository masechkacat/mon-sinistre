import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
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
}
