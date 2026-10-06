import { describe, expect, it } from 'vitest';
import { agendaParaRestaurar, escolherDaAgenda, nomeDaAgendaTroca, pushNameTrocaNome, trocaNaAgenda } from '../src/modules/conversations/contact-name';
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

describe('escolherDaAgenda', () => {
  const e = (numberId: string, name: string, dia: number) => ({ numberId, name, updatedAt: new Date(2026, 9, dia) });

  it('prefere a agenda do número onde a conversa acontece', () => {
    expect(escolherDaAgenda([e('outro', 'Ed', 9), e('este', 'Ednilton Criatura', 1)], 'este')?.name).toBe('Ednilton Criatura');
  });

  it('sem registro do número, usa o mais recente de outro número da empresa', () => {
    expect(escolherDaAgenda([e('a', 'Antigo', 1), e('b', 'Novo', 5)], 'este')?.name).toBe('Novo');
  });

  it('sem agenda, nada', () => {
    expect(escolherDaAgenda([], 'este')).toBeUndefined();
  });
});

describe('trocaNaAgenda', () => {
  it('primeiro nome da agenda entra sem anterior', () => {
    expect(trocaNaAgenda(null, ' Lídia Luisa ')).toEqual({ name: 'Lídia Luisa', previousName: null });
  });

  it('mesmo nome ou vazio não grava nada', () => {
    expect(trocaNaAgenda({ name: 'Lídia Luisa', previousName: null }, 'Lídia Luisa')).toBeNull();
    expect(trocaNaAgenda({ name: 'Lídia Luisa', previousName: null }, '  ')).toBeNull();
  });

  it('toda troca guarda o nome anterior', () => {
    expect(trocaNaAgenda({ name: 'Lídia Luisa', previousName: null }, 'Lidia L.')).toEqual({ name: 'Lidia L.', previousName: 'Lídia Luisa' });
  });
});

describe('agendaParaRestaurar', () => {
  // o caso real: agenda "Lídia Luisa", nome de perfil "Lídia". A Evolution guarda um nome só e
  // troca pelo de perfil — se a troca chegar como agenda, a mensagem seguinte desfaz.
  it('caso Lídia: a troca era o nome de perfil, a mensagem com esse pushName restaura a agenda', () => {
    const depoisDoEvento = trocaNaAgenda({ name: 'Lídia Luisa', previousName: null }, 'Lídia')!;
    expect(depoisDoEvento).toEqual({ name: 'Lídia', previousName: 'Lídia Luisa' });
    expect(agendaParaRestaurar(depoisDoEvento, 'Lídia')).toBe('Lídia Luisa');
  });

  it('troca de verdade na agenda do celular fica: o pushName é outro', () => {
    expect(agendaParaRestaurar({ name: 'Lidia L.', previousName: 'Lídia Luisa' }, 'Lídia')).toBeNull();
  });

  it('sem nome anterior ou sem pushName não restaura', () => {
    expect(agendaParaRestaurar({ name: 'Lídia', previousName: null }, 'Lídia')).toBeNull();
    expect(agendaParaRestaurar({ name: 'Lídia', previousName: 'Lídia Luisa' }, undefined)).toBeNull();
    expect(agendaParaRestaurar({ name: 'Lídia', previousName: 'Lídia Luisa' }, '  ')).toBeNull();
  });
});

