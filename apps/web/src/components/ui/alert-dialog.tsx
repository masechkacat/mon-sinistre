import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export { AlertDialogPrimitive as AlertDialog };

export function AlertDialogContent(
  props: Omit<
    ComponentProps<typeof AlertDialogPrimitive.Popup>,
    'className'
  > & {
    className?: string;
  },
) {
  const { className, ...rest } = props;
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop className="fixed inset-0 bg-(--encre)/40" />
      <AlertDialogPrimitive.Popup
        className={cn(
          'fixed top-1/2 left-1/2 w-[min(90vw,28rem)] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border bg-background p-6 shadow-lg outline-none',
          className,
        )}
        {...rest}
      />
    </AlertDialogPrimitive.Portal>
  );
}
