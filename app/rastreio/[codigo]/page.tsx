'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { Package, MapPin, Calendar, Clock, ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, Truck, HelpCircle } from 'lucide-react';

interface Evento {
  status: string;
  data: string;
  descricao: string;
  local: string;
}

interface RastreioData {
  codigo: string;
  status: 'postado' | 'em_transito' | 'saiu_para_entrega' | 'entregue' | 'extraviado';
  historico: Evento[];
  atualizado_em: string;
}

export default function RastreioPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = use(params);
  const router = useRouter();
  
  const [data, setData] = useState<RastreioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTracking = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rastreio/${codigo}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Código de rastreamento não encontrado. Verifique se digitou corretamente.');
        }
        throw new Error('Erro ao carregar informações de rastreio.');
      }
      const jsonData = await res.json();
      setData(jsonData);
    } catch (err: any) {
      setError(err.message || 'Erro de conexão.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracking();
  }, [codigo]);

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'postado':
        return { label: 'Postado', color: 'bg-blue-500 text-white', icon: Package, desc: 'Objeto postado pelo remetente.' };
      case 'em_transito':
        return { label: 'Em Trânsito', color: 'bg-indigo-500 text-white', icon: Truck, desc: 'Objeto em movimentação entre unidades.' };
      case 'saiu_para_entrega':
        return { label: 'Saiu para Entrega', color: 'bg-amber-500 text-slate-900', icon: MapPin, desc: 'Objeto saiu para entrega ao destinatário.' };
      case 'entregue':
        return { label: 'Entregue', color: 'bg-emerald-500 text-white', icon: CheckCircle2, desc: 'Objeto entregue ao destinatário com sucesso.' };
      case 'extraviado':
        return { label: 'Extraviado', color: 'bg-red-500 text-white', icon: AlertCircle, desc: 'Objeto não localizado no fluxo postal.' };
      default:
        return { label: 'Desconhecido', color: 'bg-slate-500 text-white', icon: HelpCircle, desc: 'Status do pedido pendente de atualização.' };
    }
  };

  const statusList: ('postado' | 'em_transito' | 'saiu_para_entrega' | 'entregue')[] = [
    'postado',
    'em_transito',
    'saiu_para_entrega',
    'entregue',
  ];

  return (
    <div className="flex flex-col flex-1 min-h-screen bg-slate-950 text-slate-100 font-sans p-4 sm:p-8">
      <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col justify-start py-6 sm:py-12">
        
        {/* Top Header Controls */}
        <div className="flex justify-between items-center mb-8">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800/80 transition-colors text-sm font-medium text-slate-300"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>
          
          <button
            onClick={fetchTracking}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800/80 transition-colors text-sm font-medium text-slate-300 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-slate-400 animate-pulse text-sm">Buscando informações da sua encomenda...</p>
          </div>
        ) : error ? (
          <div className="bg-slate-900/50 border border-red-500/20 rounded-2xl p-8 text-center space-y-4">
            <div className="inline-flex p-3 rounded-full bg-red-500/10 text-red-400 mb-2">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-semibold text-white">Oops! Algo deu errado</h2>
            <p className="text-slate-400 max-w-md mx-auto text-sm">{error}</p>
            <button
              onClick={() => router.push('/')}
              className="mt-4 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl transition-colors font-medium text-sm"
            >
              Tentar outro código
            </button>
          </div>
        ) : data ? (
          <div className="space-y-6">
            
            {/* Summary card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/5 rounded-full filter blur-3xl" />
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 z-10 relative">
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Código de Rastreio</span>
                  <h2 className="text-2xl font-mono font-bold text-white mt-1">{data.codigo}</h2>
                </div>
                
                <div className="flex items-center gap-3">
                  {(() => {
                    const info = getStatusInfo(data.status);
                    const IconComp = info.icon;
                    return (
                      <>
                        <div className={`p-2.5 rounded-xl ${info.color}`}>
                          <IconComp className="w-6 h-6" />
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Status Atual</span>
                          <p className="text-lg font-bold text-white mt-0.5">{info.label}</p>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Progress Stepper for standard path */}
              {data.status !== 'extraviado' && (
                <div className="mt-8 border-t border-slate-800/80 pt-6">
                  <div className="grid grid-cols-4 relative">
                    {/* Line connection */}
                    <div className="absolute top-[18px] left-[12.5%] right-[12.5%] h-0.5 bg-slate-800 -z-10" />
                    
                    {/* Colored active line */}
                    {(() => {
                      const activeIndex = statusList.indexOf(data.status as any);
                      const widthPct = activeIndex === -1 ? '0%' : `${(activeIndex / 3) * 100}%`;
                      return (
                        <div
                          className="absolute top-[18px] left-[12.5%] h-0.5 bg-indigo-500 transition-all duration-500 -z-10"
                          style={{ width: `calc(${widthPct} - 0%)` }}
                        />
                      );
                    })()}

                    {statusList.map((step, idx) => {
                      const isActive = statusList.indexOf(data.status as any) >= idx && data.status !== 'extraviado';
                      const isCurrent = data.status === step;
                      const stepInfo = getStatusInfo(step);
                      const StepIcon = stepInfo.icon;
                      
                      return (
                        <div key={step} className="flex flex-col items-center text-center">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                            isCurrent
                              ? 'bg-indigo-600 border-indigo-500 text-white ring-4 ring-indigo-500/20 scale-110'
                              : isActive
                              ? 'bg-slate-900 border-indigo-500 text-indigo-400'
                              : 'bg-slate-950 border-slate-800 text-slate-600'
                          }`}>
                            <StepIcon className="w-4 h-4" />
                          </div>
                          <span className={`text-[10px] sm:text-xs font-semibold mt-3 ${
                            isCurrent ? 'text-white' : isActive ? 'text-slate-300' : 'text-slate-600'
                          }`}>
                            {stepInfo.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Timeline history */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                Histórico de Atualizações
              </h3>

              {data.historico.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  Nenhum evento registrado ainda.
                </div>
              ) : (
                <div className="relative border-l-2 border-slate-800 ml-4 pl-6 space-y-8">
                  {data.historico.slice().reverse().map((event, idx) => {
                    const info = getStatusInfo(event.status);
                    const EventIcon = info.icon;
                    const eventDate = new Date(event.data);
                    
                    return (
                      <div key={idx} className="relative">
                        {/* Bullet point icon */}
                        <div className={`absolute -left-[35px] top-0.5 w-6 h-6 rounded-full flex items-center justify-center ${
                          idx === 0 ? info.color : 'bg-slate-800 text-slate-400'
                        } border border-slate-950`}>
                          <EventIcon className="w-3.5 h-3.5" />
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                            <span className={`font-semibold text-sm ${idx === 0 ? 'text-white' : 'text-slate-300'}`}>
                              {event.descricao}
                            </span>
                            <div className="flex items-center gap-3 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5" />
                                {eventDate.toLocaleDateString('pt-BR')}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                {eventDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1.5 text-xs text-slate-400">
                            <MapPin className="w-3.5 h-3.5 text-slate-500" />
                            <span>{event.local}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        ) : null}
      </div>
    </div>
  );
}
