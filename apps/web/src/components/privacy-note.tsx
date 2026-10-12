import Link from 'next/link';

export function PrivacyNote({
  purpose,
  linkLabel,
}: {
  purpose: string;
  linkLabel: string;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      {purpose}{' '}
      <Link
        href="/politique-de-confidentialite"
        className="underline underline-offset-4"
      >
        {linkLabel}
      </Link>
    </p>
  );
}
