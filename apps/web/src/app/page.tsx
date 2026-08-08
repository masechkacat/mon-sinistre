import { fr } from '@/i18n/fr';

export default function Home() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold">{fr.serviceName}</h1>
      <p className="mt-4 text-lg">{fr.home.subtitle}</p>
      <p className="mt-8 text-sm">
        {fr.home.skeletonNote} <code>{fr.home.skeletonPath}</code>
      </p>
    </div>
  );
}
