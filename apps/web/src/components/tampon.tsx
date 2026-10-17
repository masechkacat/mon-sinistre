import { cn } from '@/lib/utils';

/** The lettering of a stamp, and of the small lines around a hero figure. */
export const capsClassName =
  'text-[0.8125rem] font-bold tracking-wider uppercase';

/** A word stamped on paper: small caps inside a rotated frame. */
export function Tampon({
  className,
  children,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        capsClassName,
        'w-fit -rotate-3 border-2 border-current px-2',
        className,
      )}
      {...props}
    >
      {children}
    </p>
  );
}
