'use client';

import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { VEILLE_UNSUBSCRIBE_PATH } from '@mon-sinistre/contracts';
import { AnnouncedResult } from '@/components/announced-result';
import { MessageScreen } from '@/components/message-screen';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api/client';
import { fr } from '@/i18n/fr';

export function VeilleDesinscriptionConfirmer() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const desinscriptionMutation = useMutation({
    mutationFn: () =>
      apiFetch<void>(VEILLE_UNSUBSCRIBE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }),
  });

  if (desinscriptionMutation.isSuccess) {
    return (
      <AnnouncedResult
        title={fr.veille.desinscription.confirmer.done.title}
        description={fr.veille.desinscription.confirmer.done.description}
        announce={desinscriptionMutation.isSuccess}
        testId="veille-desinscription-result"
      />
    );
  }

  return (
    <MessageScreen
      title={fr.veille.desinscription.confirmer.page.title}
      description={fr.veille.desinscription.confirmer.description}
    >
      <Button
        type="button"
        onClick={() => desinscriptionMutation.mutate()}
        disabled={desinscriptionMutation.isPending}
      >
        {desinscriptionMutation.isPending
          ? fr.veille.desinscription.confirmer.unsubscribing
          : fr.veille.desinscription.confirmer.unsubscribeButton}
      </Button>
      {desinscriptionMutation.isError ? <RequestError /> : null}
    </MessageScreen>
  );
}
