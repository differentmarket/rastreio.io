'use client';

import React, { useState, useEffect } from 'react';
import { X, Sparkles, Shirt, Dumbbell, Laptop, ShoppingBag, Check, ArrowRight, Loader2 } from 'lucide-react';

interface TemplateStep {
  step_number: number;
  step_name: string;
  default_delay_minutes: number;
  default_template_text: string;
  default_coupon_code: string;
}

interface NicheGroup {
  label: string;
  icon: string;
  steps: TemplateStep[];
}

interface TemplateLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNicheTemplate: (stepsToApply: any[]) => void;
}

const NICHE_ICONS: Record<string, React.ReactNode> = {
  moda: <Shirt className="w-5 h-5 text-pink-400" />,
  cosmeticos: <Sparkles className="w-5 h-5 text-amber-400" />,
  suplementos: <Dumbbell className="w-5 h-5 text-emerald-400" />,
  eletronicos: <Laptop className="w-5 h-5 text-sky-400" />,
  geral: <ShoppingBag className="w-5 h-5 text-indigo-400" />,
};

export default function TemplateLibraryModal({
  isOpen,
  onClose,
  onSelectNicheTemplate,
}: TemplateLibraryModalProps) {
  const [niches, setNiches] = useState<Record<string, NicheGroup>>({});
  const [loading, setLoading] = useState(false);
  const [selectedNicheKey, setSelectedNicheKey] = useState<string>('moda');

  useEffect(() => {
    if (!isOpen) return;
    const fetchLibrary = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/recovery/templates');
        if (res.ok) {
          const data = await res.json();
          setNiches(data.niches || {});
          const keys = Object.keys(data.niches || {});
          if (keys.length > 0 && !data.niches[selectedNicheKey]) {
            setSelectedNicheKey(keys[0]);
          }
        }
      } catch (err) {
        console.error('Erro ao carregar biblioteca de templates:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLibrary();
  }, [isOpen]);

  if (!isOpen) return null;

  const currentNiche = niches[selectedNicheKey];

  const handleApply = () => {
    if (!currentNiche || !currentNiche.steps) return;
    // Clona os passos sem vínculo permanente, formatados para a régua da loja
    const clonedSteps = currentNiche.steps.map((s, idx) => ({
      step_number: idx + 1,
      step_name: s.step_name,
      delay_minutes: s.default_delay_minutes,
      template_text: s.default_template_text,
      coupon_code: s.default_coupon_code || '',
      is_active: true,
      channel: 'whatsapp',
    }));

    onSelectNicheTemplate(clonedSteps);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Modelos de Régua Prontos por Nicho</h3>
              <p className="text-xs text-slate-400">Escolha uma estratégia validada para o seu segmento e personalize como quiser.</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin text-violet-500 mb-2" />
            <span className="text-xs">Carregando estratégias por nicho...</span>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-800">
            {/* Lista de Nichos à Esquerda */}
            <div className="p-4 space-y-2 overflow-y-auto bg-slate-950/40">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block px-2 mb-1">
                Selecione o Nicho
              </span>

              {Object.entries(niches).map(([key, item]) => {
                const isSelected = key === selectedNicheKey;
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setSelectedNicheKey(key)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-violet-600/20 text-white border border-violet-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {NICHE_ICONS[key] || <ShoppingBag className="w-4 h-4" />}
                      <span>{item.label}</span>
                    </div>
                    {isSelected && <ArrowRight className="w-3.5 h-3.5 text-violet-400" />}
                  </button>
                );
              })}
            </div>

            {/* Detalhes e Passos do Nicho Selecionado à Direita */}
            <div className="md:col-span-2 p-5 overflow-y-auto space-y-4">
              {currentNiche ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-white">{currentNiche.label}</h4>
                      <p className="text-xs text-slate-400">Sequência recomendada de {currentNiche.steps?.length || 0} passos automáticos</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {currentNiche.steps?.map((step) => {
                      const delayFormatted =
                        step.default_delay_minutes >= 1440
                          ? `${Math.round(step.default_delay_minutes / 1440)} dia(s)`
                          : step.default_delay_minutes >= 60
                          ? `${Math.round(step.default_delay_minutes / 60)} hora(s)`
                          : `${step.default_delay_minutes} minutos`;

                      return (
                        <div key={step.step_number} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-violet-500/20 text-violet-300 font-bold flex items-center justify-center text-[10px]">
                                {step.step_number}
                              </span>
                              <span className="font-bold text-white">{step.step_name}</span>
                            </div>

                            <div className="flex items-center gap-2">
                              {step.default_coupon_code && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  Cupom: {step.default_coupon_code}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                                Enviar após {delayFormatted}
                              </span>
                            </div>
                          </div>

                          <p className="text-xs text-slate-300 whitespace-pre-wrap line-clamp-3 bg-slate-900/50 p-2 rounded-lg border border-slate-800/50 font-sans leading-relaxed">
                            {step.default_template_text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-center py-10 text-xs text-slate-500">Selecione um nicho ao lado.</div>
              )}
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            * Ao aplicar, a sequência será clonada na sua loja e você poderá editar qualquer texto ou delay.
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={loading || !currentNiche}
              className="px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-indigo-950/40 cursor-pointer disabled:opacity-50 transition-all"
            >
              <Check className="w-4 h-4" />
              Aplicar Este Modelo na Minha Régua
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
