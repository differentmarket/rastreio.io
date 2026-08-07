'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  Package, Search, Shield, LogOut, ChevronRight, Loader2, Calendar,
  MapPin, User, FileText, CheckCircle, RefreshCw, PlusCircle, ArrowLeft, Clock,
  Send, CheckCheck, Mail, AlertTriangle, ShoppingBag, Download, Inbox,
  RotateCcw, Store, Zap, ArrowRight, ExternalLink, CheckCircle2, XCircle,
} from 'lucide-react';

// ─────────────── Types ───────────────
interface OrderList {
  id: string;
  shopify_order_id?: number;
  numero_pedido: string;
  status_pedido: string;
  valor_total: number;
  created_at: string;
  shopify_fulfillment_status?: string | null;
  customers: { nome: string; email: string } | null;
  trackings: {
    codigo_rastreio: string;
    status: string;
    email_enviado?: boolean;
    email_enviado_em?: string | null;
    shopify_synced?: boolean;
  } | null;
}

interface OrderDetail extends OrderList {
  itens: { id: number; title: string; quantity: number; price: string; sku: string | null }[];
  customers: { id: string; nome: string; email: string; telefone: string | null; cpf?: string } | null;
  addresses: {
    logradouro: string; numero?: string; complemento: string;
    bairro?: string; cidade: string; estado: string; cep: string; pais: string;
  } | null;
  trackings: {
    codigo_rastreio: string; status: string; historico: any[];
    email_enviado?: boolean; email_enviado_em?: string | null; shopify_synced?: boolean;
  } | null;
}

interface EmailQueueItem {
  id: string;
  numero_pedido: string;
  status_pedido: string;
  created_at: string;
  customers: { nome: string; email: string } | null;
  trackings: {
    codigo_rastreio: string;
    status: string;
    email_enviado: boolean;
    email_enviado_em: string | null;
    shopify_synced: boolean;
  } | null;
}

// ─────────────── Helpers ───────────────
const STATUS_PEDIDO_LABELS: Record<string, { label: string; cls: string }> = {
  pendente:  { label: 'Pendente',   cls: 'bg-slate-700/60 text-slate-300' },
  pago:      { label: 'Pago',       cls: 'bg-emerald-500/15 text-emerald-400' },
  separacao: { label: 'Separação',  cls: 'bg-yellow-500/15 text-yellow-400' },
  enviado:   { label: 'Enviado',    cls: 'bg-blue-500/15 text-blue-400' },
  entregue:  { label: 'Entregue',   cls: 'bg-indigo-500/15 text-indigo-400' },
  cancelado: { label: 'Cancelado',  cls: 'bg-red-500/15 text-red-400' },
};

const TRACKING_LABELS: Record<string, string> = {
  postado: 'Postado', em_transito: 'Em Trânsito',
  saiu_para_entrega: 'Saiu p/ Entrega', entregue: 'Entregue', extraviado: 'Extraviado',
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_PEDIDO_LABELS[status] || { label: status, cls: 'bg-slate-700/60 text-slate-300' };
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${s.cls}`}>{s.label}</span>;
}

function EmailBadge({ enviado, data }: { enviado?: boolean; data?: string | null }) {
  if (enviado) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
        <CheckCheck className="w-3 h-3" />
        E-mail enviado
        {data && <span className="text-slate-500">· {new Date(data).toLocaleDateString('pt-BR')}</span>}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[10px] text-slate-500">
      <Mail className="w-3 h-3" />
      Aguardando envio
    </span>
  );
}

// ─────────────── Main Component ───────────────
export default function AdminPage() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'pedidos' | 'fila' | 'settings'>('pedidos');

  // Pedidos
  const [orders, setOrders] = useState<OrderList[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sync Shopify
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ count: number; error?: string } | null>(null);

  // Update tracking
  const [updateStatus, setUpdateStatus] = useState('em_transito');
  const [updateDesc, setUpdateDesc] = useState('');
  const [updateLocal, setUpdateLocal] = useState('');
  const [submittingUpdate, setSubmittingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Email sending
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [shopifyFulfilled, setShopifyFulfilled] = useState<boolean | null>(null);

  // Fila de e-mails
  const [emailQueue, setEmailQueue] = useState<EmailQueueItem[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueFilter, setQueueFilter] = useState<'todos' | 'enviados' | 'pendentes'>('todos');
  const [resendingId, setResendingId] = useState<string | null>(null);

  // Settings
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');
  const [shopifyWebhookSecret, setShopifyWebhookSecret] = useState('');
  const [delayPostadoEmTransito, setDelayPostadoEmTransito] = useState('2');
  const [delayEmTransitoSaiuEntrega, setDelayEmTransitoSaiuEntrega] = useState('3');
  const [delaySaiuEntregaEntregue, setDelaySaiuEntregaEntregue] = useState('1');
  const [empresaNome, setEmpresaNome] = useState('');
  const [empresaCnpj, setEmpresaCnpj] = useState('');
  const [empresaEndereco, setEmpresaEndereco] = useState('');
  const [empresaCidade, setEmpresaCidade] = useState('');
  const [empresaEstado, setEmpresaEstado] = useState('');
  const [empresaCep, setEmpresaCep] = useState('');
  const [resendApiKey, setResendApiKey] = useState('');
  const [resendFromEmail, setResendFromEmail] = useState('');
  const [nextPublicAppUrl, setNextPublicAppUrl] = useState('');
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // ── Auth ──
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) fetchOrders();
    else { setOrders([]); setSelectedOrder(null); }
  }, [session]);

  useEffect(() => {
    if (session && activeTab === 'settings') fetchSettings();
    if (session && activeTab === 'fila') fetchEmailQueue();
  }, [session, activeTab]);

  // ── Fetch ──
  const getToken = () => session?.access_token;

  const fetchOrders = async () => {
    setLoadingOrders(true);
    try {
      const res = await fetch('/api/pedidos', { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error();
      setOrders(await res.json());
    } catch { /* silent */ } finally {
      setLoadingOrders(false);
    }
  };

  const fetchOrderDetail = async (orderId: string) => {
    setLoadingDetail(true);
    setUpdateError(null);
    setEmailSent(false);
    setEmailError(null);
    setShopifyFulfilled(null);
    try {
      const res = await fetch(`/api/pedidos/${orderId}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSelectedOrder(data);
      setUpdateDesc('');
      setUpdateLocal('');
    } catch { /* silent */ } finally {
      setLoadingDetail(false);
    }
  };

  const fetchEmailQueue = async () => {
    setLoadingQueue(true);
    try {
      const res = await fetch('/api/fila-emails', { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error();
      setEmailQueue(await res.json());
    } catch { /* silent */ } finally {
      setLoadingQueue(false);
    }
  };

  const fetchSettings = async () => {
    setLoadingSettings(true);
    try {
      const res = await fetch('/api/settings', { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setShopifyDomain(data.SHOPIFY_STORE_DOMAIN || '');
      setShopifyToken(data.SHOPIFY_ADMIN_TOKEN || '');
      setShopifyWebhookSecret(data.SHOPIFY_WEBHOOK_SECRET || '');
      setDelayPostadoEmTransito(data.DELAY_POSTADO_EM_TRANSITO || '2');
      setDelayEmTransitoSaiuEntrega(data.DELAY_EM_TRANSITO_SAIU_ENTREGA || '3');
      setDelaySaiuEntregaEntregue(data.DELAY_SAIU_ENTREGA_ENTREGUE || '1');
      setEmpresaNome(data.EMPRESA_NOME || '');
      setEmpresaCnpj(data.EMPRESA_CNPJ || '');
      setEmpresaEndereco(data.EMPRESA_ENDERECO || '');
      setEmpresaCidade(data.EMPRESA_CIDADE || '');
      setEmpresaEstado(data.EMPRESA_ESTADO || '');
      setEmpresaCep(data.EMPRESA_CEP || '');
      setResendApiKey(data.RESEND_API_KEY || '');
      setResendFromEmail(data.RESEND_FROM_EMAIL || '');
      setNextPublicAppUrl(data.NEXT_PUBLIC_APP_URL || '');
    } catch (err: any) {
      setSettingsError(err.message || 'Erro ao carregar.');
    } finally {
      setLoadingSettings(false);
    }
  };

  // ── Actions ──
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        if (supabaseUrl.includes('mock-project')) {
          setSession({ user: { email: email || 'admin@teste.com' }, access_token: 'mock-session-token' });
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

  const handleSyncShopify = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/shopify/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao sincronizar.');

      // Se vier mockOrders, adiciona à lista local
      if (data.mockOrders?.length) {
        setOrders(prev => {
          const existingIds = new Set(prev.map(o => o.id));
          const newOrders = data.mockOrders.filter((o: OrderList) => !existingIds.has(o.id));
          return [...newOrders, ...prev];
        });
      } else {
        await fetchOrders();
      }

      setSyncResult({ count: data.sincronizados });
    } catch (err: any) {
      setSyncResult({ count: 0, error: err.message || 'Falha ao sincronizar.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSendEmail = async (orderId?: string) => {
    const id = orderId || selectedOrder?.id;
    if (!id) return;

    if (orderId) {
      // Chamada da fila
      setResendingId(orderId);
    } else {
      setSendingEmail(true);
      setEmailError(null);
      setEmailSent(false);
      setShopifyFulfilled(null);
    }

    try {
      const res = await fetch(`/api/pedidos/${id}/enviar-rastreio`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar.');

      if (!orderId) {
        setEmailSent(true);
        setShopifyFulfilled(data.shopifyFulfilled);
        // Atualiza o pedido na lista
        setOrders(prev => prev.map(o => o.id === id
          ? { ...o, trackings: o.trackings ? { ...o.trackings, email_enviado: true, email_enviado_em: new Date().toISOString() } : o.trackings }
          : o
        ));
      }

      // Atualiza a fila
      setEmailQueue(prev => prev.map(o => o.id === id
        ? { ...o, trackings: o.trackings ? { ...o.trackings, email_enviado: true, email_enviado_em: new Date().toISOString(), shopify_synced: data.shopifyFulfilled || false } : o.trackings }
        : o
      ));
    } catch (err: any) {
      if (!orderId) setEmailError(err.message || 'Falha ao enviar e-mail.');
    } finally {
      if (orderId) setResendingId(null);
      else setSendingEmail(false);
    }
  };

  const handleAddStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder?.trackings?.codigo_rastreio) return;
    setSubmittingUpdate(true);
    setUpdateError(null);
    try {
      const res = await fetch(`/api/rastreio/${selectedOrder.trackings.codigo_rastreio}/atualizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ status: updateStatus, descricao: updateDesc, local: updateLocal }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Erro ao atualizar.');
      }
      await fetchOrderDetail(selectedOrder.id);
      fetchOrders();
    } catch (err: any) {
      setUpdateError(err.message || 'Erro ao enviar atualização.');
    } finally {
      setSubmittingUpdate(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsError(null);
    setSettingsSuccess(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          SHOPIFY_STORE_DOMAIN: shopifyDomain,
          SHOPIFY_ADMIN_TOKEN: shopifyToken,
          SHOPIFY_WEBHOOK_SECRET: shopifyWebhookSecret,
          DELAY_POSTADO_EM_TRANSITO: delayPostadoEmTransito,
          DELAY_EM_TRANSITO_SAIU_ENTREGA: delayEmTransitoSaiuEntrega,
          DELAY_SAIU_ENTREGA_ENTREGUE: delaySaiuEntregaEntregue,
          EMPRESA_NOME: empresaNome,
          EMPRESA_CNPJ: empresaCnpj,
          EMPRESA_ENDERECO: empresaEndereco,
          EMPRESA_CIDADE: empresaCidade,
          EMPRESA_ESTADO: empresaEstado,
          EMPRESA_CEP: empresaCep,
          RESEND_API_KEY: resendApiKey,
          RESEND_FROM_EMAIL: resendFromEmail,
          NEXT_PUBLIC_APP_URL: nextPublicAppUrl,
        }),
      });
      if (!res.ok) throw new Error('Erro ao salvar.');
      setSettingsSuccess(true);
    } catch (err: any) {
      setSettingsError(err.message || 'Erro ao salvar.');
    } finally {
      setSavingSettings(false);
    }
  };

  const filteredOrders = orders.filter(o => {
    const q = searchQuery.toLowerCase();
    return (
      o.numero_pedido?.toLowerCase().includes(q) ||
      o.customers?.nome?.toLowerCase().includes(q) ||
      o.trackings?.codigo_rastreio?.toLowerCase().includes(q) ||
      o.customers?.email?.toLowerCase().includes(q)
    );
  });

  const filteredQueue = emailQueue.filter(o => {
    if (queueFilter === 'enviados') return o.trackings?.email_enviado;
    if (queueFilter === 'pendentes') return !o.trackings?.email_enviado;
    return true;
  });

  const queueStats = {
    total: emailQueue.length,
    enviados: emailQueue.filter(o => o.trackings?.email_enviado).length,
    pendentes: emailQueue.filter(o => !o.trackings?.email_enviado).length,
  };

  // ── Loading ──
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  // ── Login Page ──
  if (!session) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-zinc-950 text-white px-4">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex p-3 rounded-full bg-indigo-500/10 text-indigo-400 mb-3">
              <Shield className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white">Painel Administrativo</h1>
            <p className="text-slate-400 text-sm mt-1">Acesso restrito ao gerenciador de rastreio</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            {loginError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3.5 rounded-xl">{loginError}</div>
            )}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">E-mail</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="admin@suaempresa.com"
                className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Senha</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm" />
            </div>
            <button type="submit"
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors text-sm font-semibold text-white shadow-lg mt-2">
              Entrar
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Admin App ──
  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-white font-sans">

      {/* Top Nav */}
      <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30">
        <div className="flex items-center justify-between px-4 sm:px-6 h-14">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <Package className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white leading-none">Admin Rastreio</p>
              <p className="text-[10px] text-indigo-400 font-semibold tracking-widest uppercase leading-none mt-0.5">Shopify Suite v1</p>
            </div>
          </div>

          {/* Tab Navigation */}
          <nav className="hidden sm:flex items-center gap-1 bg-slate-950/60 border border-slate-800 rounded-xl p-1">
            {([
              { key: 'pedidos', label: 'Pedidos & Rastreio', icon: Package },
              { key: 'fila',    label: 'Fila de E-mails',    icon: Mail },
              { key: 'settings', label: 'Configuração Shopify', icon: Store },
            ] as const).map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === key
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}>
                <Icon className="w-3.5 h-3.5" />
                {label}
                {key === 'fila' && queueStats.pendentes > 0 && (
                  <span className="bg-amber-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {queueStats.pendentes}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 hidden sm:block">{session?.user?.email}</span>
            <button onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile Tabs */}
        <div className="sm:hidden flex border-t border-slate-800 divide-x divide-slate-800">
          {([
            { key: 'pedidos', label: 'Pedidos', icon: Package },
            { key: 'fila',    label: 'E-mails',  icon: Mail },
            { key: 'settings', label: 'Config',  icon: Store },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors ${
                activeTab === key ? 'text-indigo-400' : 'text-slate-500'
              }`}>
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* ═══════════ TAB: PEDIDOS ═══════════ */}
      {activeTab === 'pedidos' && (
        <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>

          {/* Left: Order List */}
          <div className="w-full lg:w-[380px] flex flex-col border-r border-slate-800 flex-shrink-0 overflow-hidden">

            {/* List Header */}
            <div className="p-3 border-b border-slate-800 space-y-2 bg-slate-900/30">
              {/* Sync Button */}
              <button onClick={handleSyncShopify} disabled={syncing}
                className="w-full flex items-center justify-center gap-2 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60 rounded-xl text-xs font-semibold text-white transition-all shadow-md shadow-indigo-900/30">
                {syncing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sincronizando...</> : <><Download className="w-3.5 h-3.5" /> Sincronizar com Shopify</>}
              </button>

              {syncResult && (
                <div className={`text-[10px] px-3 py-1.5 rounded-lg text-center font-medium ${
                  syncResult.error ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                }`}>
                  {syncResult.error ? `❌ ${syncResult.error}` : `✅ ${syncResult.count} pedidos sincronizados com sucesso`}
                </div>
              )}

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-500" />
                  <input type="text" placeholder="Buscar pedido, cliente..." value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>
                <button onClick={fetchOrders} disabled={loadingOrders}
                  className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-400 disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingOrders ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="text-[10px] text-slate-500 text-center">
                {filteredOrders.length} pedido{filteredOrders.length !== 1 ? 's' : ''}
              </div>
            </div>

            {/* List Items */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-900/60">
              {loadingOrders ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-500 mb-2" />
                  <span className="text-xs">Carregando pedidos...</span>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-xs gap-2">
                  <ShoppingBag className="w-8 h-8 text-slate-700" />
                  <p>Nenhum pedido encontrado.</p>
                  <p className="text-slate-600">Clique em "Sincronizar" para importar da Shopify.</p>
                </div>
              ) : (
                filteredOrders.map(o => (
                  <button key={o.id} onClick={() => fetchOrderDetail(o.id)}
                    className={`w-full text-left p-4 hover:bg-slate-900/60 cursor-pointer transition-colors ${
                      selectedOrder?.id === o.id ? 'bg-indigo-600/10 border-l-2 border-indigo-500 pl-3' : ''
                    }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-white">#{o.numero_pedido}</span>
                          <StatusBadge status={o.status_pedido} />
                          {o.trackings?.shopify_synced && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-semibold">Shopify ✓</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-200 font-medium truncate">{o.customers?.nome || '—'}</p>
                        <p className="text-[10px] text-slate-500 truncate">{o.customers?.email}</p>
                        {o.trackings?.codigo_rastreio && (
                          <p className="text-[10px] font-mono text-indigo-400">{o.trackings.codigo_rastreio}</p>
                        )}
                        <EmailBadge enviado={o.trackings?.email_enviado} data={o.trackings?.email_enviado_em} />
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 mt-1 flex-shrink-0" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: Order Detail */}
          <div className={`flex-1 flex flex-col overflow-hidden bg-slate-900/5 ${selectedOrder ? 'flex' : 'hidden lg:flex items-center justify-center'}`}>
            {loadingDetail ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-2" />
                <span className="text-sm text-slate-400">Carregando detalhes...</span>
              </div>
            ) : selectedOrder ? (
              <div className="flex-1 overflow-y-auto flex flex-col">

                {/* Mobile back */}
                <div className="p-4 border-b border-slate-800 bg-slate-900/30 flex items-center lg:hidden">
                  <button onClick={() => setSelectedOrder(null)} className="flex items-center gap-1.5 text-xs text-indigo-400 font-medium">
                    <ArrowLeft className="w-4 h-4" /> Voltar para lista
                  </button>
                </div>

                {/* Order Header */}
                <div className="p-5 border-b border-slate-800 bg-slate-900/50">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Pedido</span>
                      <h2 className="text-2xl font-bold text-white">#{selectedOrder.numero_pedido}</h2>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <StatusBadge status={selectedOrder.status_pedido} />
                        {selectedOrder.shopify_fulfillment_status === 'fulfilled' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-semibold">Shopify: Fulfillment ✓</span>
                        )}
                        <span className="text-[10px] text-slate-500">
                          {new Date(selectedOrder.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      {selectedOrder.trackings?.codigo_rastreio && (
                        <div className="bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2 text-right">
                          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest block">Código de Rastreio</span>
                          <span className="text-base font-mono font-extrabold text-indigo-400">{selectedOrder.trackings.codigo_rastreio}</span>
                        </div>
                      )}

                      {/* Email + Shopify action */}
                      {selectedOrder.trackings?.codigo_rastreio && selectedOrder.customers?.email && (
                        <div className="flex items-center gap-2">
                          {/* Botão de gerar Nota de Compra */}
                          <button
                            onClick={() => {
                              const printWindow = window.open('', '_blank');
                              if (printWindow) {
                                printWindow.document.write(`
                                  <html>
                                    <head>
                                      <title>Nota de Compra #${selectedOrder.numero_pedido}</title>
                                      <style>
                                        body { font-family: 'Courier New', monospace; padding: 20px; color: #000; background: #fff; }
                                        .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 10px; margin-bottom: 20px; }
                                        .company-name { font-size: 18px; font-weight: bold; }
                                        .section { margin-bottom: 15px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
                                        .section-title { font-weight: bold; text-decoration: underline; margin-bottom: 5px; }
                                        .row { display: flex; justify-content: space-between; font-size: 12px; margin: 3px 0; }
                                        .item-header { font-weight: bold; border-bottom: 1px solid #000; margin-top: 10px; }
                                        .footer { text-align: center; margin-top: 30px; font-size: 10px; border-top: 2px dashed #000; padding-top: 10px; }
                                      </style>
                                    </head>
                                    <body>
                                      <div class="header">
                                        <div class="company-name">${empresaNome || 'MINHA EMPRESA LTDA'}</div>
                                        <div>CNPJ: ${empresaCnpj || '00.000.000/0001-00'}</div>
                                        <div>Endereço: ${empresaEndereco || 'Rua Principal, 100'}</div>
                                        <div>CEP: ${empresaCep || '01000-000'} - ${empresaCidade || 'São Paulo'}/${empresaEstado || 'SP'}</div>
                                        <div style="margin-top: 10px; font-weight: bold;">NOTA DE COMPRA (SEM VALOR FISCAL)</div>
                                      </div>

                                      <div class="section">
                                        <div class="section-title">DADOS DO CLIENTE</div>
                                        <div class="row"><span>Nome:</span> <span>${selectedOrder.customers?.nome || '—'}</span></div>
                                        <div class="row"><span>CPF:</span> <span>${selectedOrder.customers?.cpf || '—'}</span></div>
                                        <div class="row"><span>E-mail:</span> <span>${selectedOrder.customers?.email || '—'}</span></div>
                                        <div class="row"><span>Telefone:</span> <span>${selectedOrder.customers?.telefone || '—'}</span></div>
                                      </div>

                                      <div class="section">
                                        <div class="section-title">ENDEREÇO DE ENTREGA</div>
                                        ${selectedOrder.addresses ? `
                                          <div class="row"><span>Rua/Logradouro:</span> <span>${selectedOrder.addresses.logradouro || ''}, ${selectedOrder.addresses.numero || ''}</span></div>
                                          <div class="row"><span>Compl:</span> <span>${selectedOrder.addresses.complemento || '—'}</span></div>
                                          <div class="row"><span>Bairro:</span> <span>${selectedOrder.addresses.bairro || '—'}</span></div>
                                          <div class="row"><span>Cidade/UF:</span> <span>${selectedOrder.addresses.cidade || ''}/${selectedOrder.addresses.estado || ''}</span></div>
                                          <div class="row"><span>CEP:</span> <span>${selectedOrder.addresses.cep || ''}</span></div>
                                        ` : '<div>Sem endereço de entrega cadastrado.</div>'}
                                      </div>

                                      <div class="section">
                                        <div class="section-title">ITENS DO PEDIDO</div>
                                        <div class="row item-header">
                                          <span style="width: 50%;">Item</span>
                                          <span style="width: 15%; text-align: center;">Qtd</span>
                                          <span style="width: 15%; text-align: right;">Unit</span>
                                          <span style="width: 20%; text-align: right;">Total</span>
                                        </div>
                                        ${selectedOrder.itens?.map((item: any) => `
                                          <div class="row">
                                            <span style="width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.title}</span>
                                            <span style="width: 15%; text-align: center;">${item.quantity}</span>
                                            <span style="width: 15%; text-align: right;">R$ ${parseFloat(item.price).toFixed(2)}</span>
                                            <span style="width: 20%; text-align: right;">R$ ${(item.quantity * parseFloat(item.price)).toFixed(2)}</span>
                                          </div>
                                        `).join('')}
                                      </div>

                                      <div class="row" style="font-weight: bold; font-size: 14px; margin-top: 15px;">
                                        <span>TOTAL DO PEDIDO:</span>
                                        <span>R$ ${selectedOrder.valor_total?.toFixed(2) || '0.00'}</span>
                                      </div>

                                      <div class="footer">
                                        <p>Código de Rastreio: ${selectedOrder.trackings?.codigo_rastreio || '—'}</p>
                                        <p>Data do Pedido: ${new Date(selectedOrder.created_at).toLocaleDateString('pt-BR')}</p>
                                        <p style="font-weight: bold; margin-top: 10px;">OBRIGADO PELA PREFERÊNCIA!</p>
                                      </div>
                                    </body>
                                  </html>
                                `);
                                printWindow.document.close();
                                printWindow.print();
                              }
                            }}
                            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 border border-slate-700/80 rounded-xl transition-all text-xs font-semibold shadow-md"
                          >
                            <FileText className="w-3.5 h-3.5" /> Nota de Compra
                          </button>

                          <button onClick={() => handleSendEmail()}
                            disabled={sendingEmail || emailSent}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-xs font-semibold shadow-md ${
                              emailSent
                                ? 'bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 cursor-default'
                                : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white disabled:opacity-60'
                            }`}>
                            {sendingEmail ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...</>
                            ) : emailSent ? (
                              <><CheckCheck className="w-3.5 h-3.5" /> E-mail + Shopify OK!</>
                            ) : (
                              <><Zap className="w-3.5 h-3.5" /> Enviar rastreio + processar Shopify</>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Detail Grid */}
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-5">

                  {/* Cliente */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-indigo-400" /> Dados do Cliente
                    </h3>
                    <InfoRow label="Nome" value={selectedOrder.customers?.nome} />
                    <InfoRow label="E-mail" value={selectedOrder.customers?.email} mono />
                    {selectedOrder.customers?.telefone && <InfoRow label="Telefone" value={selectedOrder.customers.telefone} />}
                    {selectedOrder.customers?.cpf && <InfoRow label="CPF" value={selectedOrder.customers.cpf} mono />}
                  </div>

                  {/* Endereço */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-indigo-400" /> Endereço de Entrega
                    </h3>
                    {selectedOrder.addresses ? (
                      <div className="text-xs text-slate-300 space-y-1">
                        <p>{selectedOrder.addresses.logradouro}{selectedOrder.addresses.numero ? `, ${selectedOrder.addresses.numero}` : ''}</p>
                        {selectedOrder.addresses.complemento && <p className="text-slate-400">{selectedOrder.addresses.complemento}</p>}
                        {selectedOrder.addresses.bairro && <p className="text-slate-400">{selectedOrder.addresses.bairro}</p>}
                        <p>{selectedOrder.addresses.cidade} / {selectedOrder.addresses.estado}</p>
                        <p className="font-mono text-slate-400">CEP: {selectedOrder.addresses.cep}</p>
                      </div>
                    ) : <p className="text-xs text-slate-500">Sem endereço cadastrado.</p>}
                  </div>

                  {/* Itens */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 md:col-span-2">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-indigo-400" /> Itens do Pedido
                    </h3>
                    <div className="divide-y divide-slate-800">
                      {selectedOrder.itens?.map((item, idx) => (
                        <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-medium text-white">{item.title}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">Qtd: {item.quantity} × R$ {item.price} · SKU: {item.sku || 'N/A'}</p>
                          </div>
                          <span className="font-semibold text-white">R$ {(item.quantity * parseFloat(item.price)).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-3 border-t border-slate-800 flex justify-between text-sm font-bold text-white">
                      <span>Total</span>
                      <span>R$ {selectedOrder.valor_total?.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Tracking Section */}
                {selectedOrder.trackings && (
                  <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-5">

                    {/* Form */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                        <PlusCircle className="w-3.5 h-3.5 text-indigo-400" /> Registrar Novo Evento
                      </h3>
                      {updateError && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2.5 rounded-lg">{updateError}</div>}
                      <form onSubmit={handleAddStatus} className="space-y-3">
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status</label>
                          <select value={updateStatus} onChange={e => setUpdateStatus(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white">
                            <option value="postado">Postado</option>
                            <option value="em_transito">Em Trânsito</option>
                            <option value="saiu_para_entrega">Saiu para Entrega</option>
                            <option value="entregue">Entregue</option>
                            <option value="extraviado">Extraviado</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Descrição</label>
                          <input type="text" required value={updateDesc} onChange={e => setUpdateDesc(e.target.value)}
                            placeholder="Ex: Objeto encaminhado para Unidade de Tratamento"
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white" />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Localidade</label>
                          <input type="text" required value={updateLocal} onChange={e => setUpdateLocal(e.target.value)}
                            placeholder="Ex: São Paulo, SP"
                            className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white" />
                        </div>
                        <button type="submit" disabled={submittingUpdate}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors">
                          {submittingUpdate ? 'Salvando...' : 'Salvar Evento'}
                        </button>
                      </form>
                    </div>

                    {/* History */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-indigo-400" /> Histórico
                      </h3>
                      <div className="relative border-l border-slate-800 ml-2.5 pl-4 space-y-4 max-h-[280px] overflow-y-auto">
                        {selectedOrder.trackings.historico?.slice().reverse().map((ev: any, idx: number) => (
                          <div key={idx} className="relative text-xs">
                            <div className="absolute -left-[21px] top-0.5 w-3.5 h-3.5 rounded-full bg-slate-800 border border-slate-900 flex items-center justify-center">
                              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                            </div>
                            <p className="font-semibold text-slate-200">{ev.descricao}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2">
                              <span>{new Date(ev.data).toLocaleString('pt-BR')}</span>
                              <span>·</span>
                              <span>{ev.local}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-3">
                <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                  <Package className="w-8 h-8 text-slate-700" />
                </div>
                <p className="text-sm">Selecione um pedido para visualizar</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ TAB: FILA DE E-MAILS ═══════════ */}
      {activeTab === 'fila' && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-5xl mx-auto space-y-5">

            {/* Header stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Total de Pedidos', value: queueStats.total, icon: Inbox, cls: 'text-slate-300' },
                { label: 'E-mails Enviados', value: queueStats.enviados, icon: CheckCheck, cls: 'text-emerald-400' },
                { label: 'Aguardando Envio', value: queueStats.pendentes, icon: Clock, cls: 'text-amber-400' },
              ].map(({ label, value, icon: Icon, cls }) => (
                <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
                  <Icon className={`w-5 h-5 mx-auto mb-1 ${cls}`} />
                  <p className={`text-2xl font-bold ${cls}`}>{value}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Filters + Refresh */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
                {(['todos', 'enviados', 'pendentes'] as const).map(f => (
                  <button key={f} onClick={() => setQueueFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                      queueFilter === f ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}>
                    {f}
                  </button>
                ))}
              </div>
              <button onClick={fetchEmailQueue} disabled={loadingQueue}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl text-xs text-slate-400 transition-colors">
                <RefreshCw className={`w-3.5 h-3.5 ${loadingQueue ? 'animate-spin' : ''}`} />
                Atualizar
              </button>
            </div>

            {/* Queue Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              {loadingQueue ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
                  <span className="text-xs">Carregando fila...</span>
                </div>
              ) : filteredQueue.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
                  <Mail className="w-8 h-8 text-slate-700" />
                  <p className="text-xs">Nenhum item nesta fila.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider">
                        <th className="px-4 py-3 text-left font-semibold">Pedido</th>
                        <th className="px-4 py-3 text-left font-semibold">Cliente</th>
                        <th className="px-4 py-3 text-left font-semibold">Código Rastreio</th>
                        <th className="px-4 py-3 text-center font-semibold">E-mail</th>
                        <th className="px-4 py-3 text-center font-semibold">Shopify</th>
                        <th className="px-4 py-3 text-left font-semibold">Enviado em</th>
                        <th className="px-4 py-3 text-center font-semibold">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredQueue.map(item => (
                        <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-white">#{item.numero_pedido}</span>
                              <StatusBadge status={item.status_pedido} />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-white font-medium">{item.customers?.nome || '—'}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{item.customers?.email}</p>
                          </td>
                          <td className="px-4 py-3 font-mono text-indigo-400 font-semibold">
                            {item.trackings?.codigo_rastreio || '—'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {item.trackings?.email_enviado
                              ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                              : <XCircle className="w-4 h-4 text-slate-600 mx-auto" />}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {item.trackings?.shopify_synced
                              ? <CheckCircle2 className="w-4 h-4 text-violet-400 mx-auto" />
                              : <XCircle className="w-4 h-4 text-slate-600 mx-auto" />}
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {item.trackings?.email_enviado_em
                              ? new Date(item.trackings.email_enviado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                              : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {!item.trackings?.email_enviado ? (
                              <button onClick={() => handleSendEmail(item.id)}
                                disabled={resendingId === item.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-[10px] font-semibold text-white transition-colors mx-auto">
                                {resendingId === item.id
                                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Enviando...</>
                                  : <><Send className="w-3 h-3" /> Enviar</>}
                              </button>
                            ) : (
                              <button onClick={() => handleSendEmail(item.id)}
                                disabled={resendingId === item.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg text-[10px] font-semibold text-slate-400 transition-colors mx-auto">
                                {resendingId === item.id
                                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Enviando...</>
                                  : <><RotateCcw className="w-3 h-3" /> Reenviar</>}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ TAB: CONFIGURAÇÕES ═══════════ */}
      {activeTab === 'settings' && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-2xl mx-auto">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400">
                  <Store className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Integração Shopify</h2>
                  <p className="text-xs text-slate-400">Credenciais do App Privado na Shopify</p>
                </div>
              </div>

              {loadingSettings ? (
                <div className="py-12 flex flex-col items-center text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
                  <span className="text-xs">Carregando...</span>
                </div>
              ) : (
                <form onSubmit={handleSaveSettings} className="space-y-4">
                  {settingsSuccess && <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-3.5 rounded-xl">✅ Configurações salvas com sucesso!</div>}
                  {settingsError && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3.5 rounded-xl">{settingsError}</div>}

                  <SettingsInput label="Domínio da Loja" value={shopifyDomain} onChange={setShopifyDomain} placeholder="exemplo.myshopify.com" hint="Insira apenas o subdomínio myshopify.com." />
                  <SettingsInput label="Token de Acesso Admin API" value={shopifyToken} onChange={setShopifyToken} placeholder="shpat_xxxx" type="password" mono hint="Requer escopos read_orders e write_orders." />
                  <SettingsInput label="Segredo do Webhook" value={shopifyWebhookSecret} onChange={setShopifyWebhookSecret} placeholder="Segredo de validação HMAC" type="password" mono />

                  <div className="pt-4 border-t border-slate-800 space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-white">Simulação da Jornada de Rastreio</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Dias em cada status para exibição ao cliente.</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <SettingsInput label="Postado → Trânsito (dias)" value={delayPostadoEmTransito} onChange={setDelayPostadoEmTransito} type="number" />
                      <SettingsInput label="Trânsito → Saiu (dias)" value={delayEmTransitoSaiuEntrega} onChange={setDelayEmTransitoSaiuEntrega} type="number" />
                      <SettingsInput label="Saiu → Entregue (dias)" value={delaySaiuEntregaEntregue} onChange={setDelaySaiuEntregaEntregue} type="number" />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-800 space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-white">Dados Fiscais / Nota de Compra</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Dados da empresa impressos na nota fiscal de compra sem valor fiscal.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SettingsInput label="Razão Social / Nome Fantasia" value={empresaNome} onChange={setEmpresaNome} placeholder="Minha Empresa Ltda" />
                      <SettingsInput label="CNPJ" value={empresaCnpj} onChange={setEmpresaCnpj} placeholder="00.000.000/0001-00" />
                    </div>
                    <SettingsInput label="Endereço de Origem" value={empresaEndereco} onChange={setEmpresaEndereco} placeholder="Rua Principal, 100" />
                    <div className="grid grid-cols-3 gap-3">
                      <SettingsInput label="Cidade" value={empresaCidade} onChange={setEmpresaCidade} placeholder="São Paulo" />
                      <SettingsInput label="Estado" value={empresaEstado} onChange={setEmpresaEstado} placeholder="SP" />
                      <SettingsInput label="CEP" value={empresaCep} onChange={setEmpresaCep} placeholder="01000-000" />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-800 space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-white">Serviço de E-mail (Resend)</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Credenciais para envio automatizado de e-mails com códigos de rastreamento.</p>
                    </div>
                    <SettingsInput label="Resend API Key" value={resendApiKey} onChange={setResendApiKey} placeholder="re_xxxxxxxxx" type="password" mono hint="Chave de API gerada no painel do Resend." />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SettingsInput label="E-mail de Remetente (From)" value={resendFromEmail} onChange={setResendFromEmail} placeholder="Rastreio <noreply@seudominio.com>" hint="Formato: Nome <remetente@dominio.com>" />
                      <SettingsInput label="URL Pública do App" value={nextPublicAppUrl} onChange={setNextPublicAppUrl} placeholder="https://seudominio.com" hint="Utilizada para gerar os links de rastreio." />
                    </div>
                  </div>

                  <button type="submit" disabled={savingSettings}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 mt-2">
                    {savingSettings ? 'Salvando...' : 'Salvar Configurações'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────── Small Helper Components ───────────────
function InfoRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-[10px] text-slate-500 block">{label}</span>
      <span className={`text-xs text-white font-medium ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function SettingsInput({
  label, value, onChange, placeholder, type = 'text', hint, mono,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; hint?: string; mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">{label}</label>
      <input type={type} required value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm ${mono ? 'font-mono' : ''}`} />
      {hint && <span className="text-[10px] text-slate-500 mt-1 block">{hint}</span>}
    </div>
  );
}
