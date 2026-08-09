'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function Providers({ children }: { children: React.ReactNode }) {
  // Created in useState, not at module level: otherwise the client would be
  // shared between the SSR requests of different users.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // One retry, not the library's three: three attempts with exponential
        // backoff leave the user in front of a loading state for ~7 s before
        // the French error appears, and the error must not read as a hang.
        defaultOptions: { queries: { retry: 1 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
