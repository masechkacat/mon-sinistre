'use client';

import { useSearchParams } from 'next/navigation';
import type { Commune } from '@mon-sinistre/contracts';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { CommuneAnswer } from '@/components/commune-answer';
import { fr } from '@/i18n/fr';

/** The commune answer alone, until the home page hands it a picked commune;
 * the commune arrives as JSON (`communeAnswerPath` in tests/support/dossier). */
export function TestCommuneAnswer() {
  const commune = JSON.parse(
    useSearchParams().get('commune') ?? 'null',
  ) as Commune | null;

  return (
    <PageContainer className="space-y-8">
      <PageTitle>{fr.communeAnswer.testPage}</PageTitle>
      {commune ? <CommuneAnswer commune={commune} /> : null}
    </PageContainer>
  );
}
