import { cn } from '@/lib/utils';

export function PageContainer({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('mx-auto max-w-2xl px-6 py-16', className)}>
      {children}
    </div>
  );
}
