import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { RemindersPreference } from '@mon-sinistre/contracts';
import type { RequestWithJwtUser } from 'src/auth/passport/jwt.strategy';
import { Public } from 'src/auth/public.decorator';
import { ThrottleByToken } from 'src/common/http/token-throttler.guard';
import { RemindersPreferenceDto } from './dto/reminders-preference.dto';
import { RemindersTokenDto } from './dto/reminders-token.dto';
import { RemindersService } from './reminders.service';

@ApiTags('rappels')
@Controller('rappels')
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  @Public()
  @ThrottleByToken()
  @Post('desinscription')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Switch the step reminders off from the link of a reminder mail',
    description:
      'Always 204, whatever the token turns out to be: unknown, belonging to ' +
      'someone else, or carried by an earlier mail (every mail rotates it) — ' +
      'all are a silent no-op, and a repeat call is not an error.',
  })
  @ApiNoContentResponse()
  async unsubscribe(@Body() body: RemindersTokenDto): Promise<void> {
    await this.reminders.disableByToken(body.token);
  }

  @Patch()
  @ApiOperation({
    summary: 'Switch the step reminders off or back on from the account',
  })
  @ApiOkResponse({ type: RemindersPreferenceDto })
  async setPreference(
    @Req() req: RequestWithJwtUser,
    @Body() body: RemindersPreferenceDto,
  ): Promise<RemindersPreference> {
    return this.reminders.setPreference(req.user.id, body.enabled);
  }
}
