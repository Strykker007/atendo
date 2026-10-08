'use client';
import { createContext, useContext } from 'react';
import { BASE_BRAND_ID, getBrand, type BrandConfig } from './brand';

const BrandContext = createContext<BrandConfig>(getBrand(BASE_BRAND_ID));

/** Recebe só o id (resolvido no servidor pelo layout) e entrega a config inteira aos componentes. */
export function BrandProvider({ brandId, children }: { brandId: string; children: React.ReactNode }) {
  return <BrandContext.Provider value={getBrand(brandId)}>{children}</BrandContext.Provider>;
}

/** Marca ativa: nome, logos, e-mail de suporte. */
export function useBrand(): BrandConfig {
  return useContext(BrandContext);
}
