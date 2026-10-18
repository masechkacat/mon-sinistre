import { RisqueCatnat, toIsoDate } from '@mon-sinistre/contracts';
import { fetchDossierApercu } from './src/lib/api/dossier';

fetchDossierApercu({
  commune: '30189',
  risque: RisqueCatnat.INONDATION,
  date: toIsoDate('2026-06-10'),
}).then((result) => process.stdout.write(JSON.stringify(result)));
