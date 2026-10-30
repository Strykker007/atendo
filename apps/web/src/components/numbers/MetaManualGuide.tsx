'use client';
import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Passo a passo do cadastro manual de um número da API oficial (docs/31-migracao-meta-oficial.md):
 * fica no próprio formulário, para quem cadastra não depender de documento à parte.
 */
export function MetaManualGuide() {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-field/60">
      <button type="button" onClick={() => setAberto((v) => !v)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-ink">
        <BookOpen size={15} className="text-meta-ink" />
        Passo a passo: onde pegar o token e os IDs
        {aberto ? <ChevronDown size={15} className="ml-auto text-faint" /> : <ChevronRight size={15} className="ml-auto text-faint" />}
      </button>
      {aberto && (
        <div className="px-3 pb-3 space-y-3 text-[12.5px] text-muted [&_b]:text-ink [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1">
          <div>
            <p className="font-medium text-ink mb-1">Uma vez (quem administra o portfólio na Meta)</p>
            <ol>
              <li>Em <b>business.facebook.com/settings → Usuários → Usuários do sistema</b>, abra o usuário do sistema do Atendo (função Funcionário serve).</li>
              <li><b>Atribuir ativos</b>: o app com <b>Controle total</b> e as <b>Contas do WhatsApp</b> dos clientes com <b>Controle total</b>. Isso só acrescenta acesso — não mexe em outro sistema que use a mesma conta.</li>
              <li><b>Gerar novo token</b>: app do Atendo, validade <b>Nunca</b>, permissões <b>whatsapp_business_messaging</b> e <b>whatsapp_business_management</b>. Guarde: o mesmo token serve para todos os números. Não use o token temporário da tela “Configuração da API” — ele expira em horas.</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-ink mb-1">Para cada número</p>
            <ol>
              <li><b>Phone Number ID</b>: em <b>business.facebook.com/wa/manage</b>, escolha a conta do WhatsApp → <b>Números de telefone</b> → o número → ID do número de telefone.</li>
              <li><b>WABA ID</b>: em <b>Configurações do negócio → Contas do WhatsApp</b>, clique na conta: o ID aparece no topo.</li>
              <li>Se o número vem de outro sistema, <b>desligue o robô/respostas automáticas dele antes</b>: daqui em diante os dois recebem as mensagens e o contato receberia resposta em dobro.</li>
              <li>Preencha os campos abaixo e clique em <b>Criar e validar</b>. O Atendo confere o token e passa a receber as mensagens. <b>Não</b> registre o número de novo nem troque o PIN na Meta: ele já está registrado.</li>
              <li>Teste: mande uma mensagem do seu celular para o número (deve aparecer em Conversas), responda pelo Atendo e veja se os templates aparecem em Nova conversa.</li>
              <li>Tudo certo? Tire o número do sistema antigo.</li>
            </ol>
          </div>
          <p>Erros comuns: <b>token expirado ou inválido</b> = token temporário ou sem a conta atribuída (use <b>Credenciais</b> no número para trocar); <b>133010</b> = número não registrado na API oficial; <b>131047</b> = passou de 24 h da última mensagem do cliente (só template).</p>
        </div>
      )}
    </div>
  );
}
