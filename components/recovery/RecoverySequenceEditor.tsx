'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Plus, CheckCircle2, AlertTriangle, Loader2, Save,
  Send, ShieldAlert, RotateCcw, HelpCircle, Layers
} from 'lucide-react';
import StepCard, { RecoveryStepItem } from './StepCard';
import WhatsAppPreview from './WhatsAppPreview';
import TemplateLibraryModal from './TemplateLibraryModal';

interface RecoverySequenceEditorProps {
  storeId?: string;
  storeName?: string;
  isOwner?: boolean;
}

const DEFAULT_INITIAL_STEPS: RecoveryStepItem[] = [
  {
    step_number: 1,
    step_name: 'Lembrete do Carrinho',
    delay_minutes: 30,
    template_text: 'Olá {primeiro_nome}! 🛒 Vi que você iniciou o pedido {numero_pedido} na {nome_loja}, mas o pagamento ainda não foi concluído.\n\nPara garantir seus itens com segurança, conclua pelo link oficial:\n👉 {link_pagamento}\n\nQualquer dúvida com Pix ou Cartão, é só responder aqui!',
    coupon_code: '',
    is_active: true,
    channel: 'whatsapp',
  },
  {
    step_number: 2,
    step_name: 'Oferta Especial com Cupom',
    delay_minutes: 240,
    template_text: 'Oi {primeiro_nome}! Separamos uma condição especial para você: use o cupom *{cupom}* e conclua seu pedido com desconto agora mesmo:\n👉 {link_pagamento}',
    coupon_code: 'VOLTA10',
    is_active: true,
    channel: 'whatsapp',
  },
  {
    step_number: 3,
    step_name: 'Última Chamada de Reserva',
    delay_minutes: 1440,
    template_text: 'Aviso importante, {primeiro_nome}! O pedido {numero_pedido} na {nome_loja} será cancelado automaticamente caso o pagamento não seja identificado.\n\nAcesse o link para concluir:\n👉 {link_pagamento}',
    coupon_code: '',
    is_active: true,
    channel: 'whatsapp',
  },
];

export default function RecoverySequenceEditor({
  storeId,
  storeName = 'Minha Loja',
  isOwner = true,
}: RecoverySequenceEditorProps) {
  const [steps, setSteps] = useState<RecoveryStepItem[]>(DEFAULT_INITIAL_STEPS);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLibraryModalOpen, setIsLibraryModalOpen] = useState(false);
  const [lastPublishedAt, setLastPublishedAt] = useState<string | null>(null);

  // Carregar os passos existentes da loja no banco
  const fetchStoreSteps = useCallback(async () => {
    if (!storeId || storeId === 'all') return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/recovery/steps?store_id=${storeId}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.steps) && data.steps.length > 0) {
          setSteps(data.steps);
          setSelectedStepIndex(0);
          const publishedItem = data.steps.find((s: any) => s.published_at);
          if (publishedItem?.published_at) {
            setLastPublishedAt(publishedItem.published_at);
          }
        } else {
          // Se ainda não tiver steps salvos, mantém o default sugerido
          setSteps(DEFAULT_INITIAL_STEPS);
        }
      }
    } catch (err: any) {
      console.error('Erro ao carregar steps de recuperação:', err);
      setErrorMessage('Falha ao sincronizar passos do servidor.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    fetchStoreSteps();
  }, [fetchStoreSteps]);

  // Atualizar campo de um passo específico
  const handleStepChange = (index: number, updated: Partial<RecoveryStepItem>) => {
    if (!isOwner) return;
    setSteps((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updated };
      return copy;
    });
  };

  // Adicionar novo passo (limite de 5)
  const handleAddStep = () => {
    if (!isOwner || steps.length >= 5) return;
    const nextNumber = steps.length + 1;
    const newStep: RecoveryStepItem = {
      step_number: nextNumber,
      step_name: `Passo ${nextNumber}`,
      delay_minutes: nextNumber === 4 ? 2880 : 4320,
      template_text: `Olá {primeiro_nome}! Passando para lembrar do seu pedido {numero_pedido} na {nome_loja}.\n👉 {link_pagamento}`,
      coupon_code: '',
      is_active: true,
      channel: 'whatsapp',
    };

    setSteps((prev) => [...prev, newStep]);
    setSelectedStepIndex(steps.length);
  };

  // Remover um passo
  const handleRemoveStep = (index: number) => {
    if (!isOwner || steps.length <= 1) return;
    setSteps((prev) => {
      const filtered = prev.filter((_, idx) => idx !== index);
      // Reordena step_number sequencialmente
      return filtered.map((s, idx) => ({ ...s, step_number: idx + 1 }));
    });
    if (selectedStepIndex >= steps.length - 1) {
      setSelectedStepIndex(Math.max(0, steps.length - 2));
    }
  };

  // Clonar modelo da biblioteca (desacoplado do banco de templates)
  const handleApplyLibraryNiche = (newSteps: any[]) => {
    if (!isOwner || !newSteps || newSteps.length === 0) return;
    setSteps(newSteps);
    setSelectedStepIndex(0);
    setSuccessMessage('Modelo por nicho aplicado com sucesso! Revise e publique quando estiver pronto.');
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  // Salvar ou Publicar
  const handleSave = async (publish = false) => {
    if (!isOwner || !storeId) return;
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/recovery/steps', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          steps,
          publish,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao salvar régua.');

      if (data.steps) {
        setSteps(data.steps);
      }

      if (publish) {
        setLastPublishedAt(new Date().toISOString());
        setSuccessMessage('🎉 Régua de recuperação publicada com sucesso! Os novos disparos seguirão esta sequência.');
      } else {
        setSuccessMessage('Configurações salvas com sucesso.');
      }

      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      setErrorMessage(err.message || 'Erro ao persistir régua de recuperação.');
    } finally {
      setSaving(false);
    }
  };

  const activeStep = steps[selectedStepIndex] || steps[0];

  return (
    <div className="space-y-6">
      {/* Top Banner de Informação e Ações Rápidas */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-white">Régua Inteligente de Recuperação</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                  {steps.length} de 5 Passos
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Configure a sequência automática de mensagens enviadas aos compradores que não concluíram o pedido.
              </p>
            </div>
          </div>

          {/* Botões de Ação do Topo */}
          <div className="flex flex-wrap items-center gap-2.5">
            {isOwner && (
              <button
                type="button"
                onClick={() => setIsLibraryModalOpen(true)}
                className="px-3.5 py-2 bg-gradient-to-r from-violet-600/20 to-indigo-600/20 hover:from-violet-600/30 hover:to-indigo-600/30 text-violet-300 border border-violet-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span>Carregar Modelo por Nicho</span>
              </button>
            )}

            <button
              type="button"
              onClick={fetchStoreSteps}
              disabled={loading}
              title="Recarregar passos salvos"
              className="p-2 bg-slate-950 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl text-xs cursor-pointer transition-colors"
            >
              <RotateCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Feedback visual de permissão Member */}
        {!isOwner && (
          <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs p-3 rounded-xl flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
            <span>Modo somente visualização. Apenas proprietários da loja possuem permissão para alterar ou publicar a régua.</span>
          </div>
        )}

        {/* Notificações de Sucesso e Erro */}
        {successMessage && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-3.5 rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3.5 rounded-xl flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Status de Publicação */}
        {lastPublishedAt && (
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
            <span>Régua em produção publicada em: <strong>{new Date(lastPublishedAt).toLocaleString('pt-BR')}</strong></span>
          </div>
        )}
      </div>

      {/* Grid Principal: Lista Linear de Steps à Esquerda e Preview WhatsApp à Direita */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Coluna da Régua (Passos Lineares) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              Etapas da Sequência
            </span>

            {isOwner && steps.length < 5 && (
              <button
                type="button"
                onClick={handleAddStep}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-violet-400 border border-slate-800 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar Passo {steps.length + 1}</span>
              </button>
            )}
          </div>

          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">
              <Loader2 className="w-6 h-6 animate-spin text-violet-500 mb-2" />
              <span className="text-xs">Carregando régua de recuperação...</span>
            </div>
          ) : (
            <div className="space-y-4">
              {steps.map((step, idx) => (
                <StepCard
                  key={step.step_number}
                  step={step}
                  isSelected={idx === selectedStepIndex}
                  isOwner={isOwner}
                  canRemove={steps.length > 1}
                  onSelect={() => setSelectedStepIndex(idx)}
                  onChange={(upd) => handleStepChange(idx, upd)}
                  onRemove={() => handleRemoveStep(idx)}
                />
              ))}

              {steps.length >= 5 && (
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 text-center">
                  Limite de 5 passos atingido para manter a melhor taxa de conversão e evitar fadiga do comprador.
                </div>
              )}
            </div>
          )}

          {/* Botões de Ação Inferiores */}
          {isOwner && (
            <div className="pt-4 flex flex-wrap items-center justify-end gap-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => handleSave(false)}
                disabled={saving || loading}
                className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>Salvar Rascunho</span>
              </button>

              <button
                type="button"
                onClick={() => handleSave(true)}
                disabled={saving || loading}
                className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>Publicar Régua Ativa</span>
              </button>
            </div>
          )}
        </div>

        {/* Coluna do Preview Visual do WhatsApp */}
        <div className="lg:col-span-5 space-y-4 sticky top-6">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-violet-400" />
              Preview no WhatsApp (Passo {activeStep?.step_number || 1})
            </span>
          </div>

          <WhatsAppPreview
            templateText={activeStep?.template_text || ''}
            couponCode={activeStep?.coupon_code || ''}
            storeName={storeName}
            stepNumber={activeStep?.step_number || 1}
          />

          {/* Legenda Informativa de Variáveis */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-[11px] text-slate-400 space-y-2">
            <span className="font-bold text-slate-300 block flex items-center gap-1">
              <HelpCircle className="w-3.5 h-3.5 text-violet-400" />
              Variáveis Automáticas no Disparo:
            </span>
            <ul className="space-y-1 text-[10.5px]">
              <li><code className="text-violet-300 font-mono">{'{primeiro_nome}'}</code> — Primeiro nome do comprador.</li>
              <li><code className="text-violet-300 font-mono">{'{numero_pedido}'}</code> — Número oficial da compra na Shopify.</li>
              <li><code className="text-violet-300 font-mono">{'{link_pagamento}'}</code> — Link oficial de checkout para conclusão.</li>
              <li><code className="text-violet-300 font-mono">{'{cupom}'}</code> — Código promocional configurado na etapa.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Modal de Biblioteca de Templates por Nicho */}
      <TemplateLibraryModal
        isOpen={isLibraryModalOpen}
        onClose={() => setIsLibraryModalOpen(false)}
        onSelectNicheTemplate={handleApplyLibraryNiche}
      />
    </div>
  );
}
