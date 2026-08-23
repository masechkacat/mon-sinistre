import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type {
  SinistreDetail,
  SinistreSummary,
  Step,
} from '@mon-sinistre/contracts';
import type { RequestWithJwtUser } from 'src/auth/passport/jwt.strategy';
import { CreateSinistreDto } from './dto/create-sinistre.dto';
import { SinistreDetailResponseDto } from './dto/sinistre-detail-response.dto';
import { SinistreSummaryResponseDto } from './dto/sinistre-summary-response.dto';
import { StepResponseDto } from './dto/step-response.dto';
import { UpdateStepDto } from './dto/update-step.dto';
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

  @Get()
  @ApiOperation({
    summary: 'List the caller’s sinistres',
    description: 'Own dossiers only, freshest created first.',
  })
  @ApiOkResponse({ type: SinistreSummaryResponseDto, isArray: true })
  async findAll(@Req() req: RequestWithJwtUser): Promise<SinistreSummary[]> {
    return this.sinistres.findAll(req.user.id);
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a sinistre',
    description:
      'Its steps and links cascade by schema. Same ownership answer as ' +
      'GET /sinistres/:id.',
  })
  @ApiNoContentResponse()
  async remove(
    @Req() req: RequestWithJwtUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.sinistres.remove(req.user.id, id);
  }

  @Patch(':id/etapes/:stepId')
  @ApiOperation({
    summary: 'Mark, unmark, or exclude a plan step',
    description:
      '`status: null` unmarks the step. Same ownership answer as ' +
      'GET /sinistres/:id.',
  })
  @ApiOkResponse({ type: StepResponseDto })
  async updateStep(
    @Req() req: RequestWithJwtUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() dto: UpdateStepDto,
  ): Promise<Step> {
    return this.sinistres.updateStep(req.user.id, id, stepId, dto.status);
  }
}
