'use client';

import { useState } from 'react';
import { PageContainer } from '@/components/page-container';
import { PageTitle } from '@/components/page-title';
import { PlanList } from '@/components/plan/plan-list';
import { fr } from '@/i18n/fr';
import { planCases } from './cases';

export function TestPlan() {
  const [marque, setMarque] = useState('');

  return (
    <PageContainer className="space-y-8">
      <PageTitle>{fr.dossier.testPage}</PageTitle>
      <div data-testid="plan-lecture">
        <PlanList steps={planCases} />
      </div>
      <div data-testid="plan-edition">
        <PlanList
          steps={planCases}
          onMark={(step, mark) => setMarque(`${step.order}:${mark ?? ''}`)}
        />
      </div>
      <p data-testid="dernier-marquage">{marque}</p>
    </PageContainer>
  );
}
