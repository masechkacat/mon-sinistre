import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from 'src/auth/public.decorator';
import { ThrottleByToken } from 'src/common/http/token-throttler.guard';
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
}
