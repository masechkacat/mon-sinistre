import { Field } from '@base-ui/react/field';
import { cn } from '@/lib/utils';

// `match` and the outer conditional are both load-bearing: without `match`
// Base UI never shows an error its own validation did not produce (validation
// here is the form's), and without the conditional an empty error container
// stays in the DOM with the field pointing at it via aria-describedby.
export function FieldError({
  error,
  className,
}: {
  error?: string;
  className?: string;
}) {
  if (!error) return null;
  return (
    <Field.Error
      match
      role="alert"
      className={cn('text-sm text-destructive', className)}
    >
      {error}
    </Field.Error>
  );
}
