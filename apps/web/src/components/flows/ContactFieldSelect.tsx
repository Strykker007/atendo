'use client';
import { CONTACT_FIELD_LABEL, type ContactField } from '@atendo/shared';
import { useContactAttributeLabels } from '@/lib/hooks';
import { inputCls } from '@/components/ui/Modal';

/** Mesmo destino para respostas do contato e campos retornados pela API. */
export function ContactFieldSelect({ value, onChange }: { value?: ContactField; onChange: (value?: ContactField) => void }) {
  const labels = useContactAttributeLabels().data ?? [];
  return <select aria-label="Campo da ficha do contato" className={`${inputCls} min-w-0 max-w-full`} value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as ContactField | undefined)}>
    <option value="">Só no fluxo</option>
    <optgroup label="Campos fixos">{Object.entries(CONTACT_FIELD_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</optgroup>
    <optgroup label="Campos livres">{labels.map(({ label }) => <option key={label} value={`attribute:${label}`}>{label}</option>)}</optgroup>
  </select>;
}
