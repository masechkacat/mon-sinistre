'use client';

import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { AnnouncedResult } from '@/components/announced-result';
import { MessageScreen } from '@/components/message-screen';
import { RequestError } from '@/components/request-error';
import { Button } from '@/components/ui/button';
import { unsubscribeVeille } from '@/lib/api/veille';
import { fr } from '@/i18n/fr';

export function VeilleDesinscriptionConfirmer() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const desinscriptionMutation = useMutation({
    mutationFn: () => unsubscribeVeille(token),
  });

  return (
    <AnnouncedResult
      result={
        desinscriptionMutation.isSuccess
          ? fr.veille.desinscription.confirmer.done
          : undefined
      }
      announce={desinscriptionMutation.isSuccess}
      testId="veille-desinscription-result"
    >
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
    </AnnouncedResult>
  );
}
