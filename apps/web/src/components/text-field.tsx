'use client';

import { Field } from '@base-ui/react/field';
import type { ComponentProps } from 'react';
import { FieldError } from '@/components/field-error';
import {
  inputFrameClassName,
  inputFrameInvalidClassName,
} from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TextFieldProps {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error?: string;
}

function TextField({
  label,
  value,
  onValueChange,
  error,
  ...control
}: TextFieldProps &
  Pick<ComponentProps<'input'>, 'type' | 'autoComplete' | 'placeholder'>) {
  return (
    <Field.Root invalid={Boolean(error)} className="space-y-1.5">
      <Field.Label className="block text-sm font-medium">{label}</Field.Label>
      <Field.Control
        {...control}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          inputFrameClassName,
          'w-full px-3 py-1.5 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/50',
          error && inputFrameInvalidClassName,
        )}
      />
      <FieldError error={error} />
    </Field.Root>
  );
}

export function EmailField(props: TextFieldProps & { placeholder: string }) {
  return <TextField type="email" autoComplete="email" {...props} />;
}

export function PasswordField(
  props: TextFieldProps & { autoComplete: 'new-password' | 'current-password' },
) {
  return <TextField type="password" {...props} />;
}
