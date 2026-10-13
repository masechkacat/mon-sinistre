import { PickType } from '@nestjs/swagger';
import { CreateSinistreDto } from 'src/sinistres/dto/create-sinistre.dto.js';

/** The commune of `GET /dossier/arretes`, under the `codeInsee` rules of
 * `POST /sinistres` — picked off its DTO instead of restated (research,
 * «Публичные эндпоинты»). */
export class CommuneArretesQueryDto extends PickType(CreateSinistreDto, [
  'codeInsee',
] as const) {}
