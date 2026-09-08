'use client';

import React from 'react';
import { Clock, Trash2, Tag, Eye, Power, MessageSquare } from 'lucide-react';

export interface RecoveryStepItem {
  id?: string;
  step_number: number;
  step_name: string;
  delay_minutes: number;
  template_text: string;
  coupon_code: string;
  is_active: boolean;
  channel?: string;
}

interface StepCardProps {
  step: RecoveryStepItem;
  isSelected: boolean;
  isOwner: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onChange: (updated: Partial<RecoveryStepItem>) => void;
  onRemove: () => void;
}

const PRESET_DELAYS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hora' },
  { value: 120, label: '2 horas' },
  { value: 240, label: '4 horas' },
  { value: 720, label: '12 horas' },
  { value: 1440, label: '24 horas (1 dia)' },
  { value: 2880, label: '48 horas (2 dias)' },
];

const AVAILABLE_TAGS = [
  { tag: '{primeiro_nome}', label: 'Nome' },
  { tag: '{numero_pedido}', label: 'Nº Pedido' },
  { tag: '{nome_loja}', label: 'Loja' },
  { tag: '{link_pagamento}', label: 'Link Pagamento' },
  { tag: '{cupom}', label: 'Cupom' },
  { tag: '{valor_pedido}', label: 'Valor' },
  { tag: '{itens_pedido}', label: 'Itens' },
];

export default function StepCard({
  step,
  isSelected,
  isOwner,
  canRemove,
  onSelect,
  onChange,
  onRemove,
}: StepCardProps) {
  const insertTag = (tag: string) => {
    if (!isOwner) return;
    const current = step.template_text || '';
    onChange({ template_text: `${current} ${tag}` });
  };

  return (
    <div
      onClick={onSelect}
      className={`rounded-2xl border transition-all duration-200 p-5 space-y-4 cursor-pointer relative ${
        isSelected
          ? 'bg-slate-900/95 border-violet-500/80 shadow-xl shadow-violet-950/20 ring-1 ring-violet-500/40'
          : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/70'
      } ${!step.is_active ? 'opacity-65' : ''}`}
    >
      {/* Header do Card */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-7 h-7 rounded-xl font-bold flex items-center justify-center text-xs shadow-md ${
              step.is_active
                ? 'bg-violet-600 text-white shadow-violet-900/40'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {step.step_number}
          </span>

          {isOwner ? (
            <input
              type="text"
              value={step.step_name}
              onChange={(e) => onChange({ step_name: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              placeholder={`Passo ${step.step_number}`}
              className="text-sm font-bold text-white bg-transparent border-b border-transparent hover:border-slate-700 focus:border-violet-500 focus:outline-none px-1 py-0.5"
            />
          ) : (
            <span className="text-sm font-bold text-white">{step.step_name}</span>
          )}

          {!step.is_active && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              Pausado
            </span>
          )}
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Botão de Ativação / Desativação */}
          {isOwner && (
            <button
              type="button"
              onClick={() => onChange({ is_active: !step.is_active })}
              title={step.is_active ? 'Desativar este passo' : 'Ativar este passo'}
              className={`p-1.5 rounded-xl border transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-semibold px-2.5 ${
                step.is_active
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{step.is_active ? 'Ativo' : 'Inativo'}</span>
            </button>
          )}

          {/* Botão de Preview */}
          <button
            type="button"
            onClick={onSelect}
            className={`p-1.5 rounded-xl border transition-colors cursor-pointer text-xs font-semibold px-2.5 flex items-center gap-1 ${
              isSelected
                ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview</span>
          </button>

          {/* Botão de Remoção */}
          {isOwner && canRemove && (
            <button
              type="button"
              onClick={onRemove}
              title="Excluir este passo"
              className="p-1.5 rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Seletor de Delay e Cupom em Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" onClick={(e) => e.stopPropagation()}>
        {/* Delay da Etapa */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
            <Clock className="w-3 h-3 text-violet-400" />
            Tempo de Espera (Delay)
          </label>
          <select
            disabled={!isOwner}
            value={step.delay_minutes}
            onChange={(e) => onChange({ delay_minutes: Number(e.target.value) })}
            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-semibold focus:ring-2 focus:ring-violet-500 focus:outline-none disabled:opacity-60"
          >
            {PRESET_DELAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label} após evento anterior
              </option>
            ))}
          </select>
          <span className="text-[10px] text-slate-500 mt-1 block">
            Cadência automática de disparo para este passo.
          </span>
        </div>

        {/* Cupom de Desconto */}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
            <Tag className="w-3 h-3 text-emerald-400" />
            Cupom Promocional (Opcional)
          </label>
          <input
            type="text"
            disabled={!isOwner}
            value={step.coupon_code || ''}
            onChange={(e) => onChange({ coupon_code: e.target.value.toUpperCase().trim() })}
            placeholder="EX: VOLTA10"
            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-mono font-bold focus:ring-2 focus:ring-violet-500 focus:outline-none disabled:opacity-60 uppercase"
          />
          <span className="text-[10px] text-slate-500 mt-1 block">
            Substituído automaticamente na tag {'{cupom}'}.
          </span>
        </div>
      </div>

      {/* Textarea da Mensagem & Tags Dinâmicas */}
      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <MessageSquare className="w-3 h-3 text-sky-400" />
            Template da Mensagem (WhatsApp)
          </label>

          {isOwner && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-slate-500 font-bold mr-1">Inserir:</span>
              {AVAILABLE_TAGS.map(({ tag, label }) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => insertTag(tag)}
                  className="px-1.5 py-0.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-md text-[9px] font-mono text-violet-300 transition-colors cursor-pointer"
                >
                  +{label}
                </button>
              ))}
            </div>
          )}
        </div>

        <textarea
          rows={4}
          disabled={!isOwner}
          value={step.template_text}
          onChange={(e) => onChange({ template_text: e.target.value })}
          placeholder="Escreva a mensagem personalizada para este passo da régua..."
          className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-sans focus:ring-2 focus:ring-violet-500 focus:outline-none leading-relaxed disabled:opacity-60"
        />
      </div>
    </div>
  );
}
