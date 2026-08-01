'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { 
  Package, Search, Shield, LogOut, ChevronRight, Loader2, Calendar, 
  MapPin, User, FileText, CheckCircle, RefreshCw, PlusCircle, ArrowLeft, Clock
} from 'lucide-react';

interface OrderList {
  id: string;
  shopify_order_id: number;
  numero_pedido: string;
  status_pedido: string;
  valor_total: number;
  created_at: string;
  customers: { nome: string; email: string } | null;
  trackings: { codigo_rastreio: string; status: string } | null;
}

interface OrderDetail extends OrderList {
  itens: { id: number; title: string; quantity: number; price: string; sku: string | null }[];
  customers: { id: string; nome: string; email: string; telefone: string | null; cpf: string } | null;
  addresses: {
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
    pais: string;
  } | null;
  trackings: {
    codigo_rastreio: string;
    status: string;
    historico: { status: string; data: string; descricao: string; local: string }[];
  } | null;
}

export default function AdminPage() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  
  // Data State
  const [orders, setOrders] = useState<OrderList[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Update Status Form State
  const [updateStatus, setUpdateStatus] = useState('em_transito');
  const [updateDesc, setUpdateDesc] = useState('');
  const [updateLocal, setUpdateLocal] = useState('');
  const [submittingUpdate, setSubmittingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Shopify Config states
  const [activeTab, setActiveTab] = useState<'pedidos' | 'settings'>('pedidos');
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');
  const [shopifyWebhookSecret, setShopifyWebhookSecret] = useState('');
  const [delayPostadoEmTransito, setDelayPostadoEmTransito] = useState('2');
  const [delayEmTransitoSaiuEntrega, setDelayEmTransitoSaiuEntrega] = useState('3');
  const [delaySaiuEntregaEntregue, setDelaySaiuEntregaEntregue] = useState('1');
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch settings dynamically when activeTab is settings
  useEffect(() => {
    if (session && activeTab === 'settings') {
      fetchSettings();
    }
  }, [session, activeTab]);

  // Fetch orders when session is available
  useEffect(() => {
    if (session) {
      fetchOrders();
    } else {
      setOrders([]);
      setSelectedOrder(null);
    }
  }, [session]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Se falhar e estivermos com chaves de teste/mockadas, fazemos bypass
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        if (supabaseUrl.includes('mock-project')) {
          setSession({
            user: { email: email || 'admin@teste.com' },
            access_token: 'mock-session-token'
          });
          return;
        }
        throw error;
      }
    } catch (err: any) {
      setLoginError(err.message || 'Falha na autenticação.');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const fetchSettings = async () => {
    setLoadingSettings(true);
    setSettingsError(null);
    try {
      const token = session?.access_token;
      const res = await fetch('/api/settings', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error('Não foi possível carregar as configurações.');
      const data = await res.json();
      setShopifyDomain(data.SHOPIFY_STORE_DOMAIN || '');
      setShopifyToken(data.SHOPIFY_ADMIN_TOKEN || '');
      setShopifyWebhookSecret(data.SHOPIFY_WEBHOOK_SECRET || '');
      setDelayPostadoEmTransito(data.DELAY_POSTADO_EM_TRANSITO || '2');
      setDelayEmTransitoSaiuEntrega(data.DELAY_EM_TRANSITO_SAIU_ENTREGA || '3');
      setDelaySaiuEntregaEntregue(data.DELAY_SAIU_ENTREGA_ENTREGUE || '1');
    } catch (err: any) {
      setSettingsError(err.message || 'Erro ao carregar configurações.');
    } finally {
      setLoadingSettings(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsError(null);
    setSettingsSuccess(false);
    try {
      const token = session?.access_token;
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          SHOPIFY_STORE_DOMAIN: shopifyDomain,
          SHOPIFY_ADMIN_TOKEN: shopifyToken,
          SHOPIFY_WEBHOOK_SECRET: shopifyWebhookSecret,
          DELAY_POSTADO_EM_TRANSITO: delayPostadoEmTransito,
          DELAY_EM_TRANSITO_SAIU_ENTREGA: delayEmTransitoSaiuEntrega,
          DELAY_SAIU_ENTREGA_ENTREGUE: delaySaiuEntregaEntregue,
        }),
      });

      if (!res.ok) throw new Error('Erro ao salvar as configurações.');
      setSettingsSuccess(true);
    } catch (err: any) {
      setSettingsError(err.message || 'Erro ao salvar.');
    } finally {
      setSavingSettings(false);
    }
  };

  const fetchOrders = async () => {
    setLoadingOrders(true);
    try {
      const token = session?.access_token;
      const res = await fetch('/api/pedidos', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error('Não foi possível carregar os pedidos.');
      const data = await res.json();
      setOrders(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingOrders(false);
    }
  };

  const fetchOrderDetail = async (orderId: string) => {
    setLoadingDetail(true);
    setUpdateError(null);
    try {
      const token = session?.access_token;
      const res = await fetch(`/api/pedidos/${orderId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!res.ok) throw new Error('Não foi possível carregar detalhes.');
      const data = await res.json();
      setSelectedOrder(data);
      // Pre-fill manual updates fields
      setUpdateDesc('');
      setUpdateLocal('');
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleAddStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder?.trackings?.codigo_rastreio) return;
    setSubmittingUpdate(true);
    setUpdateError(null);
    try {
      const token = session?.access_token;
      const res = await fetch(`/api/rastreio/${selectedOrder.trackings.codigo_rastreio}/atualizar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: updateStatus,
          descricao: updateDesc,
          local: updateLocal,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Erro ao atualizar.');
      }

      // Re-fetch detail and update orders list
      await fetchOrderDetail(selectedOrder.id);
      fetchOrders();
    } catch (err: any) {
      setUpdateError(err.message || 'Erro ao enviar atualização.');
    } finally {
      setSubmittingUpdate(false);
    }
  };

  const filteredOrders = orders.filter(o => {
    const query = searchQuery.toLowerCase();
    return (
      o.numero_pedido?.toLowerCase().includes(query) ||
      o.customers?.nome?.toLowerCase().includes(query) ||
      o.trackings?.codigo_rastreio?.toLowerCase().includes(query)
    );
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  // LOGIN PAGE
  if (!session) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-zinc-950 text-white px-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-xl">
          <div className="text-center mb-8">
            <div className="inline-flex p-3 rounded-full bg-indigo-500/10 text-indigo-400 mb-3">
              <Shield className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white">Painel Administrativo</h1>
            <p className="text-slate-400 text-sm mt-1">Acesso restrito ao gerenciador de rastreio</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {loginError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3.5 rounded-xl">
                {loginError}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl transition-colors text-sm font-semibold text-white shadow-lg shadow-indigo-600/25"
            >
              Entrar
            </button>
          </form>
          
          <div className="text-center mt-6">
            <a href="/" className="text-xs text-slate-500 hover:text-slate-400 transition-colors">
              Voltar para página de consulta
            </a>
          </div>
        </div>
      </div>
    );
  }

  // MAIN ADMIN DASHBOARD
  return (
    <div className="flex flex-col flex-1 min-h-screen bg-slate-950 text-slate-100 font-sans">
      
      {/* Top Navbar */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg text-white">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-white text-lg">Admin Rastreio</h1>
            <p className="text-[10px] text-indigo-400 font-semibold tracking-wider uppercase">Shopify Suite v1</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400 hidden sm:inline">{session.user.email}</span>
          <button
            onClick={handleLogout}
            className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-all"
            title="Sair"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-slate-900/50 border-b border-slate-800 px-6 flex gap-4">
        <button
          onClick={() => { setActiveTab('pedidos'); setSelectedOrder(null); }}
          className={`py-3 text-sm font-semibold border-b-2 px-1 transition-all ${
            activeTab === 'pedidos' 
              ? 'border-indigo-500 text-white' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Pedidos & Rastreio
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`py-3 text-sm font-semibold border-b-2 px-1 transition-all ${
            activeTab === 'settings' 
              ? 'border-indigo-500 text-white' 
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Configuração Shopify
        </button>
      </div>

      {/* Conditional Content Layout */}
      {activeTab === 'pedidos' ? (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          
          {/* Left Side: Orders list */}
          <div className={`lg:col-span-5 border-r border-slate-800 flex flex-col ${selectedOrder ? 'hidden lg:flex' : 'flex'}`}>
            <div className="p-4 border-b border-slate-800 bg-slate-900/30 flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Buscar pedido, cliente ou código..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <button
                onClick={fetchOrders}
                disabled={loadingOrders}
                className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-400"
              >
                <RefreshCw className={`w-4 h-4 ${loadingOrders ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-900">
              {loadingOrders ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
                  <span className="text-xs">Carregando pedidos...</span>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="text-center py-20 text-slate-500 text-xs">
                  Nenhum pedido encontrado.
                </div>
              ) : (
                filteredOrders.map((o) => (
                  <div
                    key={o.id}
                    onClick={() => fetchOrderDetail(o.id)}
                    className={`p-4 hover:bg-slate-900/50 cursor-pointer transition-colors flex items-center justify-between ${
                      selectedOrder?.id === o.id ? 'bg-indigo-600/10 border-l-4 border-indigo-500 pl-3' : ''
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-white">#{o.numero_pedido}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          o.status_pedido === 'pago' ? 'bg-emerald-500/10 text-emerald-400' :
                          o.status_pedido === 'enviado' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {o.status_pedido}
                        </span>
                      </div>
                      <div className="text-xs text-slate-300 font-medium">
                        {o.customers?.nome || 'Cliente não identificado'}
                      </div>
                      {o.trackings?.codigo_rastreio && (
                        <div className="text-[10px] text-slate-500 font-mono">
                          Rastreio: <span className="text-indigo-400 font-semibold">{o.trackings.codigo_rastreio}</span> ({o.trackings.status})
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Side: Order & Tracking Detail */}
          <div className={`lg:col-span-7 flex flex-col bg-slate-900/10 ${selectedOrder ? 'flex' : 'hidden lg:flex items-center justify-center text-slate-500 text-xs'}`}>
            {loadingDetail ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
                <span>Buscando detalhes do pedido...</span>
              </div>
            ) : selectedOrder ? (
              <div className="flex-1 overflow-y-auto flex flex-col">
                
                {/* Back controls on mobile */}
                <div className="p-4 border-b border-slate-800 bg-slate-900/30 flex items-center lg:hidden">
                  <button
                    onClick={() => setSelectedOrder(null)}
                    className="flex items-center gap-1.5 text-xs text-indigo-400 font-medium"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Voltar para lista
                  </button>
                </div>

                {/* Order Header Summary */}
                <div className="p-6 border-b border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Identificador Interno</span>
                    <h2 className="text-xl font-bold text-white mt-0.5">Pedido #{selectedOrder.numero_pedido}</h2>
                    <p className="text-xs text-slate-400 mt-1">Shopify Order ID: {selectedOrder.shopify_order_id}</p>
                  </div>
                  {selectedOrder.trackings?.codigo_rastreio && (
                    <div className="bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-right">
                      <span className="text-[10px] text-slate-500 font-bold uppercase block tracking-wider">CÓDIGO DE RASTREIO</span>
                      <span className="text-sm font-mono font-extrabold text-indigo-400">{selectedOrder.trackings.codigo_rastreio}</span>
                    </div>
                  )}
                </div>

                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Cliente & Endereço */}
                  <div className="space-y-4">
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-1">
                        <User className="w-4 h-4 text-indigo-400" />
                        Dados do Cliente
                      </h3>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Nome Completo</span>
                        <span className="text-xs text-white font-medium">{selectedOrder.customers?.nome}</span>
                      </div>
                      {selectedOrder.customers?.cpf && (
                        <div>
                          <span className="text-[10px] text-slate-500 block">CPF (Descriptografado)</span>
                          <span className="text-xs font-mono text-white font-medium">{selectedOrder.customers.cpf}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-[10px] text-slate-500 block">E-mail</span>
                        <span className="text-xs text-white font-medium">{selectedOrder.customers?.email}</span>
                      </div>
                      {selectedOrder.customers?.telefone && (
                        <div>
                          <span className="text-[10px] text-slate-500 block">Telefone</span>
                          <span className="text-xs text-white font-medium">{selectedOrder.customers.telefone}</span>
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-1">
                        <MapPin className="w-4 h-4 text-indigo-400" />
                        Endereço de Entrega
                      </h3>
                      {selectedOrder.addresses ? (
                        <div className="text-xs text-slate-300 space-y-1.5">
                          <p>{selectedOrder.addresses.logradouro}, {selectedOrder.addresses.numero}</p>
                          {selectedOrder.addresses.complemento && <p>Compl: {selectedOrder.addresses.complemento}</p>}
                          <p>{selectedOrder.addresses.bairro || 'Sem Bairro'} - {selectedOrder.addresses.cidade}/{selectedOrder.addresses.estado}</p>
                          <p className="font-mono text-slate-400">CEP: {selectedOrder.addresses.cep}</p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">Sem dados de endereço cadastrados.</p>
                      )}
                    </div>
                  </div>

                  {/* Itens do Pedido */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
                      <FileText className="w-4 h-4 text-indigo-400" />
                      Itens e Financeiro
                    </h3>
                    <div className="divide-y divide-slate-800">
                      {selectedOrder.itens?.map((item, idx) => (
                        <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-medium text-white max-w-[200px] truncate">{item.title}</p>
                            <p className="text-[10px] text-slate-500">Qtd: {item.quantity} x R$ {item.price}</p>
                          </div>
                          <span className="font-mono text-slate-400">SKU: {item.sku || 'N/A'}</span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-3 border-t border-slate-800 flex justify-between items-center text-sm font-bold text-white">
                      <span>Valor Total</span>
                      <span>R$ {selectedOrder.valor_total?.toFixed(2)}</span>
                    </div>
                  </div>

                </div>

                {/* Seção de Atualização de Rastreio */}
                {selectedOrder.trackings && (
                  <div className="p-6 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-900/20">
                    
                    {/* Formulário de Manual Update */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <PlusCircle className="w-4 h-4 text-indigo-400" />
                        Registrar Novo Evento
                      </h3>

                      {updateError && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-lg">
                          {updateError}
                        </div>
                      )}

                      <form onSubmit={handleAddStatus} className="space-y-3.5">
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status Rastreio</label>
                          <select
                            value={updateStatus}
                            onChange={(e) => setUpdateStatus(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="postado">Postado</option>
                            <option value="em_transito">Em Trânsito</option>
                            <option value="saiu_para_entrega">Saiu para Entrega</option>
                            <option value="entregue">Entregue</option>
                            <option value="extraviado">Extraviado</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Descrição</label>
                          <input
                            type="text"
                            required
                            value={updateDesc}
                            onChange={(e) => setUpdateDesc(e.target.value)}
                            placeholder="Ex: Objeto encaminhado para Unidade de Tratamento"
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Localidade / Cidade</label>
                          <input
                            type="text"
                            required
                            value={updateLocal}
                            onChange={(e) => setUpdateLocal(e.target.value)}
                            placeholder="Ex: São Paulo, SP"
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={submittingUpdate}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-lg transition-colors text-xs font-semibold text-white shadow-md"
                        >
                          {submittingUpdate ? 'Salvando...' : 'Salvar Alteração'}
                        </button>
                      </form>
                    </div>

                    {/* Listagem de Histórico Interno */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-indigo-400" />
                        Eventos Atuais
                      </h3>
                      
                      <div className="relative border-l border-slate-800 ml-2.5 pl-4 space-y-4 max-h-[250px] overflow-y-auto">
                        {selectedOrder.trackings.historico.slice().reverse().map((ev, idx) => (
                          <div key={idx} className="relative text-xs">
                            <div className="absolute -left-[21px] top-0.5 w-3.5 h-3.5 rounded-full bg-slate-800 border border-slate-900 flex items-center justify-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                            </div>
                            <div className="space-y-0.5">
                              <p className="font-semibold text-slate-200">{ev.descricao}</p>
                              <p className="text-[10px] text-slate-400 flex items-center gap-2">
                                <span>{new Date(ev.data).toLocaleString('pt-BR')}</span>
                                <span>•</span>
                                <span>{ev.local}</span>
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                )}

              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
                <span>Selecione um pedido na lista para visualizar detalhes.</span>
              </div>
            )}
          </div>

        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
            <h2 className="text-xl font-bold text-white mb-2">Integração Shopify</h2>
            <p className="text-xs text-slate-400 mb-6">
              Configure as credenciais do seu App Privado na Shopify para sincronizar pedidos e atualizar o status automaticamente.
            </p>

            {loadingSettings ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
                <span className="text-xs">Carregando configurações...</span>
              </div>
            ) : (
              <form onSubmit={handleSaveSettings} className="space-y-4">
                {settingsSuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-3.5 rounded-xl">
                    Configurações salvas com sucesso!
                  </div>
                )}
                {settingsError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3.5 rounded-xl">
                    {settingsError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Domínio da Loja (Shopify Store Domain)</label>
                  <input
                    type="text"
                    required
                    value={shopifyDomain}
                    onChange={(e) => setShopifyDomain(e.target.value)}
                    placeholder="exemplo.myshopify.com"
                    className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">Insira apenas o subdomínio myshopify.com ou domínio customizado mapeado.</span>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Token de Acesso Admin API (Admin Access Token)</label>
                  <input
                    type="password"
                    required
                    value={shopifyToken}
                    onChange={(e) => setShopifyToken(e.target.value)}
                    placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm font-mono"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">Chave gerada na aba "Desenvolver apps" da Shopify. Requer escopos `read_orders` e `write_orders`.</span>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Segredo de Assinatura do Webhook (Webhook Signing Secret)</label>
                  <input
                    type="password"
                    required
                    value={shopifyWebhookSecret}
                    onChange={(e) => setShopifyWebhookSecret(e.target.value)}
                    placeholder="Segredo de validação HMAC"
                    className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm font-mono"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">Usado para validar a autenticidade das requisições HMAC enviadas pela Shopify.</span>
                </div>

                <div className="pt-4 border-t border-slate-800 space-y-4">
                  <h3 className="text-sm font-bold text-white">Simulação da Jornada de Rastreio</h3>
                  <p className="text-xs text-slate-400">
                    Defina quantos dias o pedido demora em cada status para que a jornada automática seja exibida ao cliente.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Postado ➔ Trânsito (Dias)</label>
                      <input
                        type="number"
                        min="0"
                        required
                        value={delayPostadoEmTransito}
                        onChange={(e) => setDelayPostadoEmTransito(e.target.value)}
                        className="w-full px-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Trânsito ➔ Saiu Entrega (Dias)</label>
                      <input
                        type="number"
                        min="0"
                        required
                        value={delayEmTransitoSaiuEntrega}
                        onChange={(e) => setDelayEmTransitoSaiuEntrega(e.target.value)}
                        className="w-full px-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Saiu Entrega ➔ Entregue (Dias)</label>
                      <input
                        type="number"
                        min="0"
                        required
                        value={delaySaiuEntregaEntregue}
                        onChange={(e) => setDelaySaiuEntregaEntregue(e.target.value)}
                        className="w-full px-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-xl transition-colors text-sm font-semibold text-white shadow-lg disabled:opacity-50"
                >
                  {savingSettings ? 'Salvando...' : 'Salvar Configurações'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
