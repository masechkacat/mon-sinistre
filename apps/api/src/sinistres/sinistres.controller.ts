import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { SinistreDetail } from '@mon-sinistre/contracts';
import type { RequestWithJwtUser } from 'src/auth/passport/jwt.strategy';
import { CreateSinistreDto } from './dto/create-sinistre.dto';
import { SinistreDetailResponseDto } from './dto/sinistre-detail-response.dto';
import { SinistresService } from './sinistres.service';

/** No `@Public()` anywhere — every route goes through the global
 * `JwtAuthGuard` (`src/auth/CLAUDE.md`), as any new module's routes do by
 * default. */
@ApiTags('sinistres')
@Controller('sinistres')
export class SinistresController {
  constructor(private readonly sinistres: SinistresService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a sinistre and snapshot its plan',
    description:
      'A future eventDate answers 400. The plan is copied off the ' +
      'StepTemplate rows at this moment — editing the template later never ' +
      'changes an already-created sinistre.',
  })
  @ApiCreatedResponse({ type: SinistreDetailResponseDto })
  async create(
    @Req() req: RequestWithJwtUser,
    @Body() dto: CreateSinistreDto,
  ): Promise<SinistreDetail> {
    return this.sinistres.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read one sinistre with its plan',
    description:
      'A sinistre owned by someone else answers the same 404 as one that ' +
      "doesn't exist (apps/api/CLAUDE.md).",
  })
  @ApiOkResponse({ type: SinistreDetailResponseDto })
  async findOne(
    @Req() req: RequestWithJwtUser,
    // `id` is a `@db.Uuid` column — a malformed value would otherwise reach
    // Prisma and raise P2007, which `prisma-error.ts` does not map, turning
    // into a 500 instead of a 404.
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SinistreDetail> {
    return this.sinistres.findOne(req.user.id, id);
  }
}
