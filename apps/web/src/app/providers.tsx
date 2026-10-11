'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';

export function Providers({ children }: { children: React.ReactNode }) {
  // Created in useState, not at module level: otherwise the client would be
  // shared between the SSR requests of different users.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // One retry, not the library's three: three attempts with exponential
        // backoff leave the user in front of a loading state for ~7 s before
        // the French error appears, and the error must not read as a hang.
        // None for a 4xx: the API answers it the same way the second time.
        defaultOptions: {
          queries: {
            retry: (failureCount, error) =>
              failureCount < 1 &&
              !(
                error instanceof ApiError &&
                error.status >= 400 &&
                error.status < 500
              ),
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
