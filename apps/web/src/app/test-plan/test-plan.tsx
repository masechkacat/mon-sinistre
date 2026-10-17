'use client';

import { useState } from 'react';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { DossierFeuille } from '@/components/plan/dossier-feuille';
import { PlanList } from '@/components/plan/plan-list';
import { fr } from '@/i18n/fr';
import { planCases, planClosCases } from './cases';

export function TestPlan() {
  const [marque, setMarque] = useState('');

  return (
    <PageContainer className="space-y-8">
      <PageTitle>{fr.dossier.testPage}</PageTitle>
      {/* The read mode gets the plan with nothing settled yet: the row of what
          is behind exists only where there is something in it. */}
      <DossierFeuille data-testid="plan-lecture">
        <PlanList steps={planCases} />
      </DossierFeuille>
      <DossierFeuille data-testid="plan-edition">
        <PlanList
          steps={planClosCases}
          onMark={(step, mark) => setMarque(`${step.order}:${mark ?? ''}`)}
        />
      </DossierFeuille>
      <p data-testid="dernier-marquage">{marque}</p>
    </PageContainer>
  );
}
