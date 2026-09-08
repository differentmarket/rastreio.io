'use client';

import React from 'react';
import { CheckCheck, Store, ShieldCheck } from 'lucide-react';

interface WhatsAppPreviewProps {
  templateText: string;
  couponCode?: string;
  storeName?: string;
  stepNumber?: number;
}

export default function WhatsAppPreview({
  templateText,
  couponCode = '',
  storeName = 'Minha Loja',
  stepNumber = 1,
}: WhatsAppPreviewProps) {
  // Exemplo de dados fictícios para visualização realista do lojista
  const mockData = {
    primeiro_nome: 'Mariana',
    numero_pedido: '#1084',
    nome_loja: storeName,
    link_pagamento: 'https://rastreio.io/pay/chk_8941',
    cupom: couponCode ? `*${couponCode}*` : '*PROMO10*',
    valor_pedido: 'R$ 189,90',
    itens_pedido: 'Vestido Floral Midi (x1)',
  };

  // Substituição das variáveis dinâmicas
  let text = templateText || 'Nenhuma mensagem definida para esta etapa.';
  text = text
    .replace(/{primeiro_nome}/g, mockData.primeiro_nome)
    .replace(/{numero_pedido}/g, mockData.numero_pedido)
    .replace(/{nome_loja}/g, mockData.nome_loja)
    .replace(/{link_pagamento}/g, mockData.link_pagamento)
    .replace(/{cupom}/g, mockData.cupom)
    .replace(/{valor_pedido}/g, mockData.valor_pedido)
    .replace(/{itens_pedido}/g, mockData.itens_pedido);

  // Formatação de negrito estilo WhatsApp (*palavra*) e quebras de linha
  const renderFormattedText = (raw: string) => {
    const lines = raw.split('\n');
    return lines.map((line, lIdx) => {
      const parts = line.split(/(\*[^*]+\*)/g);
      return (
        <span key={lIdx} className="block min-h-[1.1rem]">
          {parts.map((part, pIdx) => {
            if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
              return (
                <strong key={pIdx} className="font-bold text-white">
                  {part.slice(1, -1)}
                </strong>
              );
            }
            if (part.includes('http://') || part.includes('https://')) {
              const urlParts = part.split(/(https?:\/\/[^\s]+)/g);
              return urlParts.map((u, uIdx) =>
                u.startsWith('http') ? (
                  <span key={uIdx} className="text-sky-300 underline font-medium break-all">
                    {u}
                  </span>
                ) : (
                  <span key={uIdx}>{u}</span>
                )
              );
            }
            return <span key={pIdx}>{part}</span>;
          })}
        </span>
      );
    });
  };

  return (
    <div className="w-full max-w-sm mx-auto bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col font-sans">
      {/* Header do Chat WhatsApp */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
            <Store className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white leading-tight">{storeName}</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <span className="text-[10px] text-emerald-400 font-medium block leading-tight">Conta Comercial Verificada</span>
          </div>
        </div>

        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">
          Passo {stepNumber}
        </span>
      </div>

      {/* Fundo do Chat com textura WhatsApp Dark */}
      <div className="p-4 flex-1 bg-[#0b141a] bg-[radial-gradient(#1f2c34_1px,transparent_1px)] [background-size:16px_16px] min-h-[300px] flex flex-col justify-end space-y-3">
        {/* Balão de Segurança Informativo */}
        <div className="text-center">
          <span className="inline-block bg-[#182229] border border-slate-800/80 text-amber-300/80 text-[9px] px-2.5 py-1 rounded-lg shadow-sm">
            🔒 As mensagens são protegidas com criptografia de ponta a ponta.
          </span>
        </div>

        {/* Balão da Mensagem Enviada (Verde WhatsApp Dark) */}
        <div className="self-end max-w-[88%] bg-[#005c4b] text-slate-100 rounded-2xl rounded-tr-xs p-3 shadow-md border border-[#00705a] text-xs leading-relaxed space-y-1">
          <div className="text-[11.5px] whitespace-pre-wrap">{renderFormattedText(text)}</div>

          <div className="flex items-center justify-end gap-1 text-[9px] text-emerald-200/70 pt-1 font-mono">
            <span>14:32</span>
            <CheckCheck className="w-3 h-3 text-[#53bdeb]" />
          </div>
        </div>
      </div>

      {/* Footer Informativo */}
      <div className="bg-slate-900/80 border-t border-slate-800 px-3 py-2 text-center text-[10px] text-slate-400">
        Simulação em tempo real de como o comprador receberá no celular.
      </div>
    </div>
  );
}
