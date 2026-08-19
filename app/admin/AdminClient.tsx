'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  Package, Search, Shield, LogOut, ChevronRight, Loader2, Calendar,
  MapPin, User, FileText, CheckCircle, RefreshCw, PlusCircle, ArrowLeft, Clock,
  Send, CheckCheck, Mail, AlertTriangle, ShoppingBag, Download, Inbox,
  RotateCcw, Store, Zap, ArrowRight, ExternalLink, CheckCircle2, XCircle, Building2, Users, Globe,
  BarChart3, Bot, Sparkles, MessageSquare, Palette, Pencil, Trash2, X, Link, Plus,
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
  nota_enviada?: boolean;
  nota_enviada_em?: string | null;
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
export default function AdminClient() {
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'pedidos' | 'fila' | 'analytics' | 'ai_agent' | 'settings' | 'members'>('pedidos');

  // Estados de Cadastro Manual de Pedido/Encomenda
  const [showManualOrderModal, setShowManualOrderModal] = useState(false);
  const [manualOrderNum, setManualOrderNum] = useState('');
  const [manualClientName, setManualClientName] = useState('');
  const [manualClientEmail, setManualClientEmail] = useState('');
  const [manualTrackingCode, setManualTrackingCode] = useState('');
  const [manualTrackingStatus, setManualTrackingStatus] = useState('pendente_taxa');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // Estados de Vínculo de Rastreio a Pedido Existente
  const [linkTrackingCode, setLinkTrackingCode] = useState('');
  const [linkTrackingStatus, setLinkTrackingStatus] = useState('pendente_taxa');
  const [linkingLoading, setLinkingLoading] = useState(false);
  const [linkingError, setLinkingError] = useState<string | null>(null);

  // White-Label, Evolution API e Agente de IA
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#4F46E5');
  const [bannerUrl, setBannerUrl] = useState('');
  const [bannerLink, setBannerLink] = useState('');
  const [whatsappSuporte, setWhatsappSuporte] = useState('');
  const [evolutionApiUrl, setEvolutionApiUrl] = useState('');
  const [evolutionApiKey, setEvolutionApiKey] = useState('');
  const [evolutionInstanceName, setEvolutionInstanceName] = useState('');
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [aiRecoveryEnabled, setAiRecoveryEnabled] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [aiPromptCustom, setAiPromptCustom] = useState('');
  const [aiModel, setAiModel] = useState('gpt-4o-mini');
  const [aiTone, setAiTone] = useState('amigavel');
  const [aiTemperature, setAiTemperature] = useState(0.7);
  const [aiCouponCode, setAiCouponCode] = useState('');
  const [aiConversations, setAiConversations] = useState<any[]>([]);
  const [loadingAiConversations, setLoadingAiConversations] = useState(false);

  // Pedidos
  const [orders, setOrders] = useState<OrderList[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // SaaS Multi-Tenant Stores
  const [stores, setStores] = useState<any[]>([]);
  const [activeStore, setActiveStore] = useState<any | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('all');
  const [loadingStores, setLoadingStores] = useState(false);
  const [newStoreModalOpen, setNewStoreModalOpen] = useState(false);
  const [newStoreTab, setNewStoreTab] = useState<'oauth' | 'manual'>('oauth');
  const [newStoreDomain, setNewStoreDomain] = useState('');
  const [newStoreToken, setNewStoreToken] = useState('');
  const [newStoreNome, setNewStoreNome] = useState('');
  const [newStoreCnpj, setNewStoreCnpj] = useState('');
  const [newStoreSuccess, setNewStoreSuccess] = useState(false);
  const [newStoreError, setNewStoreError] = useState<string | null>(null);
  const [savingStore, setSavingStore] = useState(false);

  // Store Members (Contas de Lojistas)
  const [storeMembers, setStoreMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitingMember, setInvitingMember] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Sync Shopify
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ count: number; error?: string } | null>(null);

  // Update tracking
  const [updateStatus, setUpdateStatus] = useState('em_transito');
  const [updateDesc, setUpdateDesc] = useState('');
  const [updateLocal, setUpdateLocal] = useState('');
  const [updateDate, setUpdateDate] = useState('');
  const [submittingUpdate, setSubmittingUpdate] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Edit / Delete tracking event
  const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);
  const [editStatus, setEditStatus] = useState('em_transito');
  const [editDesc, setEditDesc] = useState('');
  const [editLocal, setEditLocal] = useState('');
  const [editDate, setEditDate] = useState('');
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  // Email sending
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [shopifyFulfilled, setShopifyFulfilled] = useState<boolean | null>(null);

  // Fila de e-mails & Disparo em Lote
  const [emailQueue, setEmailQueue] = useState<EmailQueueItem[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueFilter, setQueueFilter] = useState<'todos' | 'enviados' | 'pendentes'>('todos');
  const [queueSearch, setQueueSearch] = useState('');
  const [queueStartDate, setQueueStartDate] = useState('');
  const [queueEndDate, setQueueEndDate] = useState('');
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [batchSending, setBatchSending] = useState(false);
  const [batchResult, setBatchResult] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    ativo: boolean;
    atual: number;
    total: number;
    sucessos: number;
    erros: number;
    percentual: number;
    statusLog: string;
  } | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

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
  const [notaDelayHoras, setNotaDelayHoras] = useState('2');
  
  // Taxa de Reenvio / Despacho Postal
  const [taxaEnabled, setTaxaEnabled] = useState(true);
  const [taxaDiasTentativas, setTaxaDiasTentativas] = useState('9,10,11');
  const [taxaDiaExibicao, setTaxaDiaExibicao] = useState('11');
  const [taxaNome, setTaxaNome] = useState('Taxa de Despacho Postal e Liberação Alfandegária');
  const [taxaValor, setTaxaValor] = useState('27.90');
  const [taxaLinkPagamento, setTaxaLinkPagamento] = useState('');

  // VeoPag Integration
  const [veopagEnabled, setVeopagEnabled] = useState(false);
  const [veopagClientId, setVeopagClientId] = useState('');
  const [veopagClientSecret, setVeopagClientSecret] = useState('');

  // Upsell & Recompra
  const [upsellEnabled, setUpsellEnabled] = useState(false);
  const [upsellTitle, setUpsellTitle] = useState('Ganhe 15% OFF na sua próxima compra!');
  const [upsellDescription, setUpsellDescription] = useState('Use o cupom CLIENTE15 no checkout e aproveite frete grátis.');
  const [upsellLink, setUpsellLink] = useState('');
  const [upsellImageUrl, setUpsellImageUrl] = useState('');

  // Métricas do Agente de IA & Recuperação por WhatsApp
  const [aiMetrics, setAiMetrics] = useState({
    total_contatados: 0,
    total_engajados: 0,
    total_convertidos: 0,
    faturamento_recuperado: 0,
    taxa_conversao: 0,
  });
  const [selectedAiConvModal, setSelectedAiConvModal] = useState<any | null>(null);
  const [aiDelayMinutes, setAiDelayMinutes] = useState('15');

  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // ── Auth ──
  useEffect(() => {
    setMounted(true);
    let timer: NodeJS.Timeout;

    timer = setTimeout(() => {
      setAuthLoading(false);
    }, 2500);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
      })
      .catch(() => { /* silent */ })
      .finally(() => {
        clearTimeout(timer);
        setAuthLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setAuthLoading(false);
    });

    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && session) {
      const params = new URLSearchParams(window.location.search);
      const shopifyConnected = params.get('shopify_connected');
      const storeId = params.get('store_id');

      if (shopifyConnected === '1') {
        window.history.replaceState({}, document.title, window.location.pathname);

        const selectNewStore = async () => {
          const res = await fetch('/api/stores', { headers: getAuthHeaders() });
          if (res.ok) {
            const data = await res.json();
            const list = data.stores || [];
            setStores(list);

            if (storeId) {
              const found = list.find((s: any) => s.id === storeId);
              if (found) {
                setActiveStore(found);
              }
            }
          }
        };

        selectNewStore();
      }
    }
  }, [session]);

  const getAuthHeaders = (): Record<string, string> => {
    const token = session?.access_token;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  const fetchStores = async () => {
    setLoadingStores(true);
    try {
      const res = await fetch('/api/stores', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStores(data.stores || []);
      }
    } catch { /* silent */ } finally {
      setLoadingStores(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    try {
      const cleanEmail = email.trim();
      const cleanPassword = password.trim();
      const { error } = await supabase.auth.signInWithPassword({ 
        email: cleanEmail, 
        password: cleanPassword 
      });
      if (error) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        if (supabaseUrl.includes('mock-project')) {
          setSession({ user: { email: cleanEmail || 'admin@teste.com' }, access_token: 'mock-session-token' });
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

  const fetchOrders = async (overrideStoreId?: string, isSilent = false) => {
    if (!isSilent) setLoadingOrders(true);
    const targetStore = overrideStoreId !== undefined ? overrideStoreId : selectedStoreId;
    try {
      const queryParam = targetStore && targetStore !== 'all' ? `?store_id=${targetStore}` : '';
      const res = await fetch(`/api/pedidos${queryParam}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error();
      setOrders(await res.json());
    } catch { /* silent */ } finally {
      if (!isSilent) setLoadingOrders(false);
    }
  };

  useEffect(() => {
    if (session) {
      fetchOrders();
      fetchStores();
    } else {
      setOrders([]);
      setSelectedOrder(null);
    }
  }, [session]);

  // ── Loading & Hydration Guard ──
  if (!mounted || authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white" style={{ backgroundColor: '#020617', minHeight: '100vh' }}>
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  // ── Login Page ──
  if (!session) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-zinc-950 text-white px-4" style={{ backgroundColor: '#020617', minHeight: '100vh' }}>
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
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-colors text-sm font-semibold text-white shadow-lg mt-2 cursor-pointer">
              Entrar
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Admin App ──
  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-white font-sans" style={{ backgroundColor: '#020617' }}>
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30 px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-white leading-none">Rastreio.IO SaaS</h1>
            <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider mt-0.5">Painel Gestor Multi-Loja</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400 font-medium">{session?.user?.email}</span>
          <button onClick={handleLogout} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 transition-colors cursor-pointer">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 p-6">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-lg font-bold text-white mb-4">Lojas Conectadas</h2>
          {stores.length === 0 ? (
            <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl text-center">
              <Store className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-sm font-bold text-white">Nenhuma loja conectada ainda</p>
              <p className="text-xs text-slate-400 mt-1">Conecte sua loja Shopify para começar o rastreamento automatizado.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stores.map(store => (
                <div key={store.id} onClick={() => setActiveStore(store)} className="p-4 bg-slate-900 border border-slate-800 rounded-xl cursor-pointer hover:border-indigo-500 transition-all">
                  <h3 className="font-bold text-white">{store.nome_loja}</h3>
                  <p className="text-xs text-slate-400">{store.shopify_domain}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
