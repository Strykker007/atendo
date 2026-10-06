import { describe, expect, it } from 'vitest';
import { phoneVariants } from '../src/modules/conversations/phone-variants';
import { parseMetaTemplate } from '../src/modules/whatsapp/providers/meta.provider';
import { buildTemplateSend, cleanTemplateParam } from '../src/modules/whatsapp/templates';
import { reminderVars } from '../src/modules/scheduling/scheduling.service';
import { reminderChoice } from '../src/modules/scheduling/reminder-reply';

describe('phoneVariants', () => {
  it('celular BR com e sem o nono dígito', () => {
    expect(phoneVariants('5562999998888')).toEqual(['5562999998888', '556299998888']);
    expect(phoneVariants('556299998888')).toEqual(['556299998888', '5562999998888']);
  });
  it('fixo e estrangeiro não têm variante', () => {
    expect(phoneVariants('556232328888')).toEqual(['556232328888']);
    expect(phoneVariants('14155552671')).toEqual(['14155552671']);
  });
});

const raw = {
  id: '1',
  name: 'lembrete_consulta',
  language: 'pt_BR',
  status: 'APPROVED',
  category: 'UTILITY',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Olá {{1}}' },
    { type: 'BODY', text: 'Sua consulta é dia {{1}} às {{2}}. Confirma?' },
    { type: 'FOOTER', text: 'Clínica X' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar' }] },
  ],
};

describe('parseMetaTemplate', () => {
  it('normaliza cabeçalho, corpo, variáveis e categoria', () => {
    const t = parseMetaTemplate(raw)!;
    expect(t).toMatchObject({ name: 'lembrete_consulta', category: 'utility', header: 'Olá {{1}}', headerParams: ['1'], bodyParams: ['1', '2'], buttons: ['Confirmar'] });
    expect(t.unsupported).toBeUndefined();
  });
  it('marca como não suportado o que o painel não preenche', () => {
    expect(parseMetaTemplate({ ...raw, components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'oi' }] })!.unsupported).toMatch(/mídia/);
    expect(parseMetaTemplate({ ...raw, category: 'AUTHENTICATION' })!.unsupported).toBeTruthy();
    expect(parseMetaTemplate({ ...raw, status: 'REJECTED' })).toBeNull();
  });
  it('variáveis com nome', () => {
    expect(parseMetaTemplate({ ...raw, components: [{ type: 'BODY', text: 'Oi {{first_name}}, {{first_name}}!' }] })!.bodyParams).toEqual(['first_name']);
  });
});

describe('buildTemplateSend', () => {
  const t = parseMetaTemplate(raw)!;
  it('monta os componentes da Cloud API e o texto do histórico', () => {
    const r = buildTemplateSend(t, { header: { 1: 'Ana' }, body: { 1: '10/10', 2: '09:00' } });
    expect(r.template).toEqual({
      name: 'lembrete_consulta',
      language: 'pt_BR',
      category: 'utility',
      components: [
        { type: 'header', parameters: [{ type: 'text', text: 'Ana' }] },
        { type: 'body', parameters: [{ type: 'text', text: '10/10' }, { type: 'text', text: '09:00' }] },
      ],
    });
    expect(r.text).toBe('*Olá Ana*\n\nSua consulta é dia 10/10 às 09:00. Confirma?\n\n_Clínica X_');
  });
  it('recusa variável vazia', () => {
    expect(() => buildTemplateSend(t, { header: { 1: 'Ana' }, body: { 1: '10/10', 2: ' ' } })).toThrow(/\{\{2\}\}/);
  });
  it('variável com nome leva parameter_name', () => {
    const named = parseMetaTemplate({ ...raw, components: [{ type: 'BODY', text: 'Oi {{first_name}}' }] })!;
    expect(buildTemplateSend(named, { body: { first_name: 'Ana' } }).template.components).toEqual([{ type: 'body', parameters: [{ type: 'text', text: 'Ana', parameter_name: 'first_name' }] }]);
  });
  it('limpa quebra de linha e espaços que a Meta recusa', () => {
    expect(cleanTemplateParam(' a\n\nb      c ')).toBe('a b   c');
  });
});

describe('lembrete por template', () => {
  it('variáveis do agendamento', () => {
    expect(reminderVars({ service: { name: 'Corte' }, professional: { name: 'Carlos' } }, { ymd: '2026-09-21', hm: '09:00', label: 'seg. 21/09 09:00' }))
      .toEqual({ servico: 'Corte', profissional: 'Carlos', data: '21/09', hora: '09:00', agendamento: 'seg. 21/09 09:00' });
  });
  it('botão de resposta rápida do template (payload = texto do botão) confirma/remarca', () => {
    expect(reminderChoice('Confirmar', 'Confirmar')).toBe('confirm');
    expect(reminderChoice('Remarcar', 'Remarcar')).toBe('reschedule');
  });
});
