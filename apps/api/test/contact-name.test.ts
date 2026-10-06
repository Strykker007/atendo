import { describe, expect, it } from 'vitest';
import { nomeDaAgendaTroca, pushNameTrocaNome } from '../src/modules/conversations/contact-name';
import { nomeDeContatoValido } from '../src/modules/whatsapp/providers/evolution.provider';

describe('pushNameTrocaNome', () => {
  it('preenche contato sem nome', () => {
    expect(pushNameTrocaNome({ name: null, nameSource: 'whatsapp' }, 'Bruno')).toBe(true);
    // nome apagado na ficha volta a aceitar o do WhatsApp
    expect(pushNameTrocaNome({ name: null, nameSource: 'manual' }, 'Bruno')).toBe(true);
  });

  it('acompanha o pushName quando o nome também veio do WhatsApp', () => {
    expect(pushNameTrocaNome({ name: 'Bruno', nameSource: 'whatsapp' }, 'Bruno Silva')).toBe(true);
  });

  it('não desfaz o nome corrigido na ficha — era o que a próxima mensagem do cliente fazia', () => {
    expect(pushNameTrocaNome({ name: 'Bruno (oficina)', nameSource: 'manual' }, 'Bruno')).toBe(false);
  });

  it('não troca o nome da agenda', () => {
    expect(pushNameTrocaNome({ name: 'Ednilton Criatura', nameSource: 'agenda' }, 'Ed')).toBe(false);
  });

  it('pushName vazio ou igual não muda nada', () => {
    expect(pushNameTrocaNome({ name: 'Bruno', nameSource: 'whatsapp' }, '  ')).toBe(false);
    expect(pushNameTrocaNome({ name: 'Bruno', nameSource: 'whatsapp' }, undefined)).toBe(false);
    expect(pushNameTrocaNome({ name: 'Bruno', nameSource: 'whatsapp' }, 'Bruno')).toBe(false);
  });
});

describe('nomeDaAgendaTroca', () => {
  it('nome da agenda substitui o pushName', () => {
    expect(nomeDaAgendaTroca({ name: 'piscinas sol nascente', nameSource: 'whatsapp' }, 'William Piscinas Sol Nascente', false)).toBe(true);
    expect(nomeDaAgendaTroca({ name: null, nameSource: 'whatsapp' }, 'Ednilton Criatura', false)).toBe(true);
  });

  it('o mesmo evento repetindo o pushName da mensagem não vira agenda', () => {
    expect(nomeDaAgendaTroca({ name: 'Ednilton Criatura', nameSource: 'agenda' }, 'Ed', true)).toBe(false);
  });

  it('agenda atualizada troca a agenda antiga', () => {
    expect(nomeDaAgendaTroca({ name: 'Thiago', nameSource: 'agenda' }, 'Thiago Campos', false)).toBe(true);
  });

  it('nunca troca nome manual', () => {
    expect(nomeDaAgendaTroca({ name: '⛔ NÃO ENVIAR — Pedro', nameSource: 'manual' }, 'Pedro', false)).toBe(false);
  });
});

describe('nomeDeContatoValido', () => {
  it('descarta o número que a Evolution manda quando não há nome', () => {
    expect(nomeDeContatoValido('553499917253', '553499917253')).toBe(false);
    expect(nomeDeContatoValido('+55 34 9991-7253', '553499917253')).toBe(false);
    expect(nomeDeContatoValido('', '553499917253')).toBe(false);
  });

  it('aceita nome com número no meio', () => {
    expect(nomeDeContatoValido('Loja 2 Centro', '553499917253')).toBe(true);
  });
});
