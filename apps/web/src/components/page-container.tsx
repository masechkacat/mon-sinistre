import { cn } from '@/lib/utils';

export function PageContainer({
  ref,
  className,
  children,
}: {
  ref?: React.Ref<HTMLDivElement>;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div ref={ref} className={cn('mx-auto max-w-2xl px-6 py-16', className)}>
      {children}
    </div>
  );
}
