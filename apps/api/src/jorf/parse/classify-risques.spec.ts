import { RisqueCatnat } from '@mon-sinistre/contracts';
import { classifyRisques } from './classify-risques';

describe('classifyRisques', () => {
  it('classifies the trois-eaux fixture wordings as INONDATION', () => {
    expect(classifyRisques('Inondations et coulées de boue')).toEqual(
      new Set([RisqueCatnat.INONDATION]),
    );
    expect(
      classifyRisques('Inondations par remontée de nappe phréatique'),
    ).toEqual(new Set([RisqueCatnat.INONDATION]));
  });

  it('returns both matching values for a combined label', () => {
    expect(
      classifyRisques('Inondations, coulées de boue et mouvements de terrain'),
    ).toEqual(
      new Set([RisqueCatnat.INONDATION, RisqueCatnat.MOUVEMENT_TERRAIN]),
    );
  });

  it('classifies the geotechnical drought wording as SECHERESSE only, despite mentioning mouvements de terrain', () => {
    expect(
      classifyRisques(
        'Mouvements de terrain différentiels consécutifs à la sécheresse et à la réhydratation des sols',
      ),
    ).toEqual(new Set([RisqueCatnat.SECHERESSE]));
  });

  it('classifies mouvements de terrain hors sécheresse géotechnique as MOUVEMENT_TERRAIN', () => {
    expect(
      classifyRisques('Mouvements de terrains (hors sécheresse géotechnique)'),
    ).toEqual(new Set([RisqueCatnat.MOUVEMENT_TERRAIN]));
  });

  it('classifies avalanches, vents cycloniques, séismes and éruptions volcaniques', () => {
    expect(classifyRisques('Avalanches')).toEqual(
      new Set([RisqueCatnat.AVALANCHE]),
    );
    expect(classifyRisques('Vents cycloniques')).toEqual(
      new Set([RisqueCatnat.VENTS_CYCLONIQUES]),
    );
    expect(classifyRisques('Séismes')).toEqual(new Set([RisqueCatnat.SEISME]));
    expect(classifyRisques('Éruptions volcaniques')).toEqual(
      new Set([RisqueCatnat.SEISME]),
    );
  });

  it('is case- and accent-insensitive, like normalizeCommuneName', () => {
    expect(classifyRisques('INONDATIONS ET COULEES DE BOUE')).toEqual(
      new Set([RisqueCatnat.INONDATION]),
    );
  });

  it('returns an empty set for a wording the JO has not printed before', () => {
    expect(classifyRisques('Invasion de criquets migrateurs')).toEqual(
      new Set(),
    );
  });
});
