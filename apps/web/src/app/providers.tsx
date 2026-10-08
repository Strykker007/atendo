'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrandProvider } from '@/lib/brand-context';

export function Providers({ brandId, children }: { brandId: string; children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } }));
  return (
    <BrandProvider brandId={brandId}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </BrandProvider>
  );
}
