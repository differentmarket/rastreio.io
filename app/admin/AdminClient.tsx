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
  const [shopifyClientId, setShopifyClientId] = useState('');
  const [shopifyClientSecret, setShopifyClientSecret] = useState('');
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

    // Timeout de segurança de 2.5s para evitar travamentos de tela em branco
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
        // Limpar parâmetros da URL de forma silenciosa
        window.history.replaceState({}, document.title, window.location.pathname);

        const selectNewStore = async () => {
          // Recarregar a lista de lojas para buscar a recém-conectada
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



  // ── Fetch ──
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

  const handleAddStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingStore(true);
    setNewStoreError(null);
    setNewStoreSuccess(false);

    try {
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          nome_loja: newStoreNome,
          shopify_domain: newStoreDomain,
          shopify_access_token: newStoreToken,
          empresa_cnpj: newStoreCnpj,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao integrar loja.');

      setNewStoreSuccess(true);
      fetchStores();
      setTimeout(() => {
        setNewStoreModalOpen(false);
        setNewStoreDomain('');
        setNewStoreToken('');
        setNewStoreNome('');
        setNewStoreCnpj('');
        setNewStoreSuccess(false);
      }, 1500);
    } catch (err: any) {
      setNewStoreError(err.message || 'Erro ao integrar loja.');
    } finally {
      setSavingStore(false);
    }
  };

  const handleConnectShopifyOAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreDomain) {
      setNewStoreError('O domínio da loja Shopify é obrigatório.');
      return;
    }

    setSavingStore(true);
    setNewStoreError(null);

    // Sanitizar domínio
    let cleanDomain = newStoreDomain.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');

    if (!cleanDomain.includes('.')) {
      cleanDomain = `${cleanDomain}.myshopify.com`;
    }

    try {
      // 1. Criar a loja temporária pendente para obter o ID
      const res = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          nome_loja: newStoreNome || cleanDomain.split('.')[0],
          shopify_domain: cleanDomain,
          shopify_access_token: null, // Preenchido no OAuth callback
          status: 'pendente',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao iniciar integração.');

      const storeId = data.store?.id;
      if (!storeId) throw new Error('ID da loja não retornado.');

      // 2. Redirecionar para o fluxo de OAuth do Shopify
      window.location.href = `/api/shopify/oauth/start?shop=${cleanDomain}&store_id=${storeId}`;
    } catch (err: any) {
      setNewStoreError(err.message || 'Erro ao iniciar fluxo de conexão.');
      setSavingStore(false);
    }
  };

  const handleDeleteStore = async (storeId: string) => {
    if (!confirm('Deseja realmente desconectar esta loja?')) return;
    try {
      const res = await fetch(`/api/stores?id=${storeId}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (res.ok) {
        fetchStores();
        if (activeStore?.id === storeId) {
          setActiveStore(null);
          setSelectedStoreId('all');
          fetchOrders('all');
        }
      }
    } catch { /* silent */ }
  };

  const handleSelectStore = (store: any) => {
    setActiveStore(store);
    setSelectedStoreId(store ? store.id : 'all');
    fetchOrders(store ? store.id : 'all');
    if (store) {
      fetchStoreMembers(store.id);
    }
  };

  const fetchStoreMembers = async (storeId: string) => {
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/stores/users?store_id=${storeId}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStoreMembers(data.users || []);
      }
    } catch { /* silent */ } finally {
      setLoadingMembers(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStore || !inviteEmail) return;
    setInvitingMember(true);
    setInviteError(null);
    setInviteSuccess(false);

    try {
      const res = await fetch('/api/stores/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ store_id: activeStore.id, email: inviteEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao vincular usuário.');

      setInviteSuccess(true);
      fetchStoreMembers(activeStore.id);
      setInviteEmail('');
      setTimeout(() => setInviteSuccess(false), 3000);
    } catch (err: any) {
      setInviteError(err.message || 'Erro ao convidar usuário.');
    } finally {
      setInvitingMember(false);
    }
  };

  const handleRemoveMember = async (bindId: string) => {
    if (!confirm('Remover acesso deste usuário a esta loja?')) return;
    try {
      const res = await fetch(`/api/stores/users?id=${bindId}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (res.ok && activeStore) {
        fetchStoreMembers(activeStore.id);
      }
    } catch { /* silent */ }
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

  const fetchOrderDetail = async (orderId: string, isSilent = false) => {
    if (!isSilent) {
      setLoadingDetail(true);
      setUpdateError(null);
      setEmailSent(false);
      setEmailError(null);
      setShopifyFulfilled(null);
    }
    try {
      const res = await fetch(`/api/pedidos/${orderId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSelectedOrder(data);
      if (!isSilent) {
        setUpdateDesc('');
        setUpdateLocal('');
      }
    } catch { /* silent */ } finally {
      if (!isSilent) setLoadingDetail(false);
    }
  };

  const fetchEmailQueue = async (isSilent = false) => {
    if (!isSilent) setLoadingQueue(true);
    try {
      const url = activeStore?.id 
        ? `/api/fila-emails?store_id=${activeStore.id}`
        : '/api/fila-emails';
      const res = await fetch(url, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error();
      setEmailQueue(await res.json());
    } catch { /* silent */ } finally {
      if (!isSilent) setLoadingQueue(false);
    }
  };

  async function fetchSettings() {
    setLoadingSettings(true);
    setSettingsError(null);
    try {
      const res = await fetch('/api/settings', { headers: getAuthHeaders() });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Falha ao carregar configurações.');
      }
      const data = await res.json();
      setShopifyDomain(data.SHOPIFY_STORE_DOMAIN || '');
      setShopifyToken(data.SHOPIFY_ADMIN_TOKEN || '');
      setShopifyWebhookSecret(data.SHOPIFY_WEBHOOK_SECRET || '');
      setShopifyClientId(data.SHOPIFY_CLIENT_ID || '');
      setShopifyClientSecret(data.SHOPIFY_CLIENT_SECRET || '');
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
      setNotaDelayHoras(data.NOTA_DELAY_HORAS || '2');
      
      setTaxaEnabled(data.TAXA_ENABLED !== 'false');
      setTaxaDiasTentativas(data.TAXA_DIAS_TENTATIVAS || '9,10,11');
      setTaxaDiaExibicao(data.TAXA_DIA_EXIBICAO || '11');
      setTaxaNome(data.TAXA_NOME || 'Taxa de Despacho Postal e Liberação Alfandegária');
      setTaxaValor(data.TAXA_VALOR || '27.90');
      setTaxaLinkPagamento(data.TAXA_LINK_PAGAMENTO || '');

      setUpsellEnabled(data.UPSELL_ENABLED === 'true');
      setUpsellTitle(data.UPSELL_TITLE || 'Ganhe 15% OFF na sua próxima compra!');
      setUpsellDescription(data.UPSELL_DESCRIPTION || 'Use o cupom CLIENTE15 no checkout e aproveite frete grátis.');
      setUpsellLink(data.UPSELL_LINK || '');
      setUpsellImageUrl(data.UPSELL_IMAGE_URL || '');

      if (activeStore) {
        setLogoUrl(activeStore.logo_url || '');
        setPrimaryColor(activeStore.primary_color || '#4F46E5');
        setBannerUrl(activeStore.banner_url || '');
        setBannerLink(activeStore.banner_link || '');
        setWhatsappSuporte(activeStore.whatsapp_suporte || '');
        setEvolutionApiUrl(activeStore.evolution_api_url || '');
        setEvolutionApiKey(activeStore.evolution_api_key || '');
        setEvolutionInstanceName(activeStore.evolution_instance_name || '');
        setWhatsappEnabled(activeStore.whatsapp_enabled || false);
        setAiRecoveryEnabled(activeStore.ai_recovery_enabled || false);
        setOpenaiApiKey(activeStore.openai_api_key || '');
        setAiPromptCustom(activeStore.ai_prompt_custom || '');
        setAiModel(activeStore.ai_model || 'gpt-4o-mini');
        setAiTone(activeStore.ai_tone || 'amigavel');
        setAiTemperature(typeof activeStore.ai_temperature === 'number' ? activeStore.ai_temperature : 0.7);
        setAiCouponCode(activeStore.ai_coupon_code || '');
        setVeopagEnabled(activeStore.veopag_enabled || false);
        setVeopagClientId(activeStore.veopag_client_id || '');
        setVeopagClientSecret(activeStore.veopag_client_secret || '');
      }
    } catch (err: any) {
      setSettingsError(err.message || 'Erro ao carregar configurações.');
    } finally {
      setLoadingSettings(false);
    }
  };

  const fetchAiConversations = async () => {
    setLoadingAiConversations(true);
    try {
      const storeIdParam = activeStore?.id || 'all';
      const res = await fetch(`/api/ai/conversations?store_id=${storeIdParam}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAiConversations(data.conversations || []);
        if (data.metrics) {
          setAiMetrics(data.metrics);
        }
      }
    } catch { /* silent */ } finally {
      setLoadingAiConversations(false);
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

  useEffect(() => {
    if (session && activeTab === 'settings') fetchSettings();
    if (session && activeTab === 'fila') fetchEmailQueue();
    if (session && activeTab === 'members' && activeStore?.id) fetchStoreMembers(activeStore.id);
  }, [session, activeTab, activeStore?.id]);

  useEffect(() => {
    if (activeStore) {
      setEmpresaNome(activeStore.empresa_nome || '');
      setEmpresaCnpj(activeStore.empresa_cnpj || '');
      setEmpresaEndereco(activeStore.empresa_endereco || '');
      setEmpresaCidade(activeStore.empresa_cidade || '');
      setEmpresaEstado(activeStore.empresa_estado || '');
      setEmpresaCep(activeStore.empresa_cep || '');
    } else {
      // Fallback para configurações globais se nenhuma loja estiver ativa
      fetchSettings();
    }
  }, [activeStore]);

  // Polling automático em tempo real (10s) sem recarregar a página
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      if (activeTab === 'pedidos') {
        fetchOrders(undefined, true);
        if (selectedOrder?.id) {
          fetchOrderDetail(selectedOrder.id, true);
        }
      } else if (activeTab === 'fila') {
        fetchEmailQueue(true);
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [session, activeTab, selectedOrder?.id, selectedStoreId]);

  // ── Actions ──
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

  const handleCreateManualOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStore) return;
    setManualLoading(true);
    setManualError(null);
    try {
      const res = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          numero_pedido: manualOrderNum,
          nome_cliente: manualClientName,
          email_cliente: manualClientEmail,
          codigo_rastreio: manualTrackingCode,
          status_rastreio: manualTrackingStatus,
          store_id: activeStore.id
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar encomenda manual.');

      // Atualiza a listagem de pedidos
      await fetchOrders();

      // Resetar form
      setManualOrderNum('');
      setManualClientName('');
      setManualClientEmail('');
      setManualTrackingCode('');
      setManualTrackingStatus('pendente_taxa');
      setShowManualOrderModal(false);
      alert('Encomenda manual de teste criada com sucesso!');
    } catch (err: any) {
      console.error(err);
      setManualError(err.message || 'Erro ao criar pedido.');
    } finally {
      setManualLoading(false);
    }
  };

  const handleLinkTrackingCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder || !activeStore) return;
    setLinkingLoading(true);
    setLinkingError(null);
    try {
      const res = await fetch('/api/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          order_id: selectedOrder.id,
          codigo_rastreio: linkTrackingCode,
          status_rastreio: linkTrackingStatus,
          store_id: activeStore.id
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao vincular rastreamento.');

      // Atualizar dados na tela e fechar modal
      await fetchOrders();
      await fetchOrderDetail(selectedOrder.id);
      setLinkTrackingCode('');
      setLinkTrackingStatus('pendente_taxa');
      alert('Rastreamento vinculado com sucesso!');
    } catch (err: any) {
      console.error(err);
      setLinkingError(err.message || 'Erro ao vincular.');
    } finally {
      setLinkingLoading(false);
    }
  };

  const handleSyncShopify = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const targetStoreId = activeStore?.id || selectedStoreId;
      const queryParam = targetStoreId && targetStoreId !== 'all' ? `?store_id=${targetStoreId}` : '';
      const res = await fetch(`/api/shopify/sync${queryParam}`, {
        method: 'POST',
        headers: getAuthHeaders(),
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
        await fetchOrders(targetStoreId);
      }

      setSyncResult({ count: data.sincronizados });
    } catch (err: any) {
      setSyncResult({ count: 0, error: err.message || 'Falha ao sincronizar.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSendBatchEmails = async (
    periodo: 'hoje' | 'ontem' | 'semana' | 'pendentes' | 'todos' | 'exceto_hoje',
    tipoNotificacao: 'ambos' | 'nota' | 'rastreio' = 'ambos'
  ) => {
    setBatchSending(true);
    setBatchResult(null);
    setBatchProgress(null);
    try {
      // 1. Obter a lista atualizada de itens da fila
      const listRes = await fetch('/api/fila-emails', { headers: getAuthHeaders() });
      const fullQueue: EmailQueueItem[] = await listRes.json();

      const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

      let targetItems = (Array.isArray(fullQueue) ? fullQueue : []).filter(item => {
        if (!item.customers?.email) return false;

        const criadoEmDiaAnterior = new Date(item.created_at).getTime() < todayStart;
        const notaJaEnviada = !!item.nota_enviada;

        if (tipoNotificacao === 'nota') {
          // Pode enviar Nota Fiscal hoje ou em qualquer dia se ainda não enviou
          return !notaJaEnviada;
        }

        if (tipoNotificacao === 'rastreio') {
          // REGRA 1 & REGRA 2: Rastreio só se criado em dia anterior E Nota Fiscal já enviada
          return !item.trackings?.email_enviado && criadoEmDiaAnterior && notaJaEnviada;
        }

        // tipo === 'ambos'
        // Pode enviar Nota se não enviou, OU pode enviar Rastreio se respeitar as 2 regras
        const podeEnviarNota = !notaJaEnviada;
        const podeEnviarRastreio = !item.trackings?.email_enviado && criadoEmDiaAnterior && notaJaEnviada;
        return podeEnviarNota || podeEnviarRastreio;
      });

      if (targetItems.length === 0) {
        setBatchResult(`✅ 0 e-mails elegíveis no momento (${tipoNotificacao === 'nota' ? 'Notas Fiscais' : 'Rastreios de compras anteriores com Nota enviada'}).`);
        return;
      }

      setBatchProgress({
        ativo: true,
        atual: 0,
        total: targetItems.length,
        sucessos: 0,
        erros: 0,
        percentual: 0,
        statusLog: `Iniciando disparo em lote para ${targetItems.length} pedidos elegíveis...`,
      });

      let okCount = 0;
      let errCount = 0;

      for (let i = 0; i < targetItems.length; i++) {
        const item = targetItems[i];
        const nomeCli = item.customers?.nome || 'Cliente';
        const emailCli = item.customers?.email || '';

        setBatchProgress({
          ativo: true,
          atual: i + 1,
          total: targetItems.length,
          sucessos: okCount,
          erros: errCount,
          percentual: Math.round(((i + 1) / targetItems.length) * 100),
          statusLog: `Enviando ${tipoNotificacao === 'nota' ? 'Nota Fiscal' : 'Notificação'} para #${item.numero_pedido} — ${nomeCli} (${emailCli})...`,
        });

        try {
          const res = await fetch('/api/pedidos/enviar-lote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ periodo, tipoNotificacao, orderId: item.id }),
          });
          const data = await res.json();
          if (res.ok && data.disparados > 0) {
            okCount++;
          } else {
            errCount++;
          }
        } catch {
          errCount++;
        }

        // Atualiza a tabela na tela em tempo real a cada envio
        fetchEmailQueue();
      }

      setBatchResult(`🎉 Concluído! ${okCount} e-mails de ${tipoNotificacao === 'nota' ? 'Nota Fiscal' : 'Notificação'} enviados com sucesso de ${targetItems.length} elegíveis (${errCount} erros).`);
    } catch (err: any) {
      setBatchResult(`❌ ${err.message || 'Erro no envio em lote.'}`);
    } finally {
      setBatchSending(false);
      setBatchProgress(null);
      fetchOrders();
      fetchEmailQueue();
    }
  };

  const handleSendNotification = async (tipo: 'rastreio' | 'nota' | 'ambos', orderId?: string) => {
    const id = orderId || selectedOrder?.id;
    if (!id) return;

    if (orderId) {
      setResendingId(orderId);
    } else {
      setSendingEmail(true);
      setEmailError(null);
      setEmailSent(false);
      setShopifyFulfilled(null);
    }

    try {
      const res = await fetch(`/api/pedidos/${id}/enviar-notificacao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ tipo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar notificação.');

      if (!orderId) {
        setEmailSent(true);
        setShopifyFulfilled(data.shopifyFulfilled);
        fetchOrderDetail(id);
        fetchOrders();
      }
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
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          action: 'add',
          status: updateStatus,
          descricao: updateDesc,
          local: updateLocal,
          data: updateDate ? new Date(updateDate).toISOString() : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Erro ao atualizar.');
      }
      setUpdateDesc('');
      setUpdateLocal('');
      setUpdateDate('');
      await fetchOrderDetail(selectedOrder.id);
      fetchOrders();
    } catch (err: any) {
      setUpdateError(err.message || 'Erro ao enviar atualização.');
    } finally {
      setSubmittingUpdate(false);
    }
  };

  const handleEditEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrder?.trackings?.codigo_rastreio || editingEventIndex === null) return;
    setSubmittingEdit(true);
    setUpdateError(null);
    try {
      const res = await fetch(`/api/rastreio/${selectedOrder.trackings.codigo_rastreio}/atualizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          action: 'edit',
          eventIndex: editingEventIndex,
          status: editStatus,
          descricao: editDesc,
          local: editLocal,
          data: editDate ? new Date(editDate).toISOString() : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Erro ao editar evento.');
      }
      setEditingEventIndex(null);
      await fetchOrderDetail(selectedOrder.id);
      fetchOrders();
    } catch (err: any) {
      setUpdateError(err.message || 'Erro ao editar evento.');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleDeleteEvent = async (index: number) => {
    if (!selectedOrder?.trackings?.codigo_rastreio) return;
    if (!confirm('Tem certeza que deseja excluir este evento do histórico?')) return;
    setDeletingIndex(index);
    setUpdateError(null);
    try {
      const res = await fetch(`/api/rastreio/${selectedOrder.trackings.codigo_rastreio}/atualizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          action: 'delete',
          eventIndex: index,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Erro ao excluir evento.');
      }
      await fetchOrderDetail(selectedOrder.id);
      fetchOrders();
    } catch (err: any) {
      setUpdateError(err.message || 'Erro ao excluir evento.');
    } finally {
      setDeletingIndex(null);
    }
  };

  const handleConnectOAuth = () => {
    const domainToUse = activeStore?.shopify_domain || shopifyDomain;
    if (!domainToUse) {
      alert("Por favor, informe o Domínio da Loja primeiro nas configurações.");
      return;
    }
    const cleanShop = domainToUse.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const storeIdParam = activeStore?.id && activeStore.id !== 'default-store' ? `&store_id=${activeStore.id}` : '';
    window.location.href = `/api/shopify/oauth/start?shop=${cleanShop}${storeIdParam}`;
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsError(null);
    setSettingsSuccess(false);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          SHOPIFY_STORE_DOMAIN: shopifyDomain,
          SHOPIFY_ADMIN_TOKEN: shopifyToken,
          SHOPIFY_WEBHOOK_SECRET: shopifyWebhookSecret,
          SHOPIFY_CLIENT_ID: shopifyClientId,
          SHOPIFY_CLIENT_SECRET: shopifyClientSecret,
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
          NOTA_DELAY_HORAS: notaDelayHoras,
          TAXA_ENABLED: String(taxaEnabled),
          TAXA_DIAS_TENTATIVAS: taxaDiasTentativas,
          TAXA_DIA_EXIBICAO: taxaDiaExibicao,
          TAXA_NOME: taxaNome,
          TAXA_VALOR: taxaValor,
          TAXA_LINK_PAGAMENTO: taxaLinkPagamento,
          UPSELL_ENABLED: String(upsellEnabled),
          UPSELL_TITLE: upsellTitle,
          UPSELL_DESCRIPTION: upsellDescription,
          UPSELL_LINK: upsellLink,
          UPSELL_IMAGE_URL: upsellImageUrl,
          OPENAI_API_KEY: openaiApiKey,
        }),
      });
      if (!res.ok) throw new Error('Erro ao salvar.');

      if (activeStore) {
        await fetch('/api/stores', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            id: activeStore.id,
            logo_url: logoUrl,
            primary_color: primaryColor,
            banner_url: bannerUrl,
            banner_link: bannerLink,
            whatsapp_suporte: whatsappSuporte,
            evolution_api_url: evolutionApiUrl,
            evolution_api_key: evolutionApiKey,
            evolution_instance_name: evolutionInstanceName,
            whatsapp_enabled: whatsappEnabled,
            ai_recovery_enabled: aiRecoveryEnabled,
            openai_api_key: openaiApiKey,
            ai_prompt_custom: aiPromptCustom,
            ai_model: aiModel,
            ai_tone: aiTone,
            ai_temperature: aiTemperature,
            ai_coupon_code: aiCouponCode,
            veopag_enabled: veopagEnabled,
            veopag_client_id: veopagClientId,
            veopag_client_secret: veopagClientSecret,
            empresa_nome: empresaNome,
            empresa_cnpj: empresaCnpj,
            empresa_endereco: empresaEndereco,
            empresa_cidade: empresaCidade,
            empresa_estado: empresaEstado,
            empresa_cep: empresaCep,
          }),
        });
        setActiveStore((prev: any) => prev ? ({
          ...prev,
          logo_url: logoUrl,
          primary_color: primaryColor,
          banner_url: bannerUrl,
          banner_link: bannerLink,
          whatsapp_suporte: whatsappSuporte,
          evolution_api_url: evolutionApiUrl,
          evolution_api_key: evolutionApiKey,
          evolution_instance_name: evolutionInstanceName,
          whatsapp_enabled: whatsappEnabled,
          ai_recovery_enabled: aiRecoveryEnabled,
          openai_api_key: openaiApiKey,
          ai_prompt_custom: aiPromptCustom,
          ai_model: aiModel,
          ai_tone: aiTone,
          ai_temperature: aiTemperature,
          ai_coupon_code: aiCouponCode,
          veopag_enabled: veopagEnabled,
          veopag_client_id: veopagClientId,
          veopag_client_secret: veopagClientSecret,
          empresa_nome: empresaNome,
          empresa_cnpj: empresaCnpj,
          empresa_endereco: empresaEndereco,
          empresa_cidade: empresaCidade,
          empresa_estado: empresaEstado,
          empresa_cep: empresaCep,
        }) : null);
        fetchStores();
      }

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
    // 1. Filtro por status de envio
    if (queueFilter === 'enviados' && !o.trackings?.email_enviado) return false;
    if (queueFilter === 'pendentes' && o.trackings?.email_enviado) return false;

    // 2. Filtro de Texto
    if (queueSearch) {
      const q = queueSearch.toLowerCase();
      const matchPedido = o.numero_pedido?.toLowerCase().includes(q);
      const matchNome = o.customers?.nome?.toLowerCase().includes(q);
      const matchEmail = o.customers?.email?.toLowerCase().includes(q);
      const matchRastreio = o.trackings?.codigo_rastreio?.toLowerCase().includes(q);
      if (!matchPedido && !matchNome && !matchEmail && !matchRastreio) return false;
    }

    // 3. Filtro por Período (criado em)
    if (queueStartDate || queueEndDate) {
      const itemDate = new Date(o.created_at);
      if (queueStartDate) {
        const start = new Date(queueStartDate + 'T00:00:00');
        if (itemDate < start) return false;
      }
      if (queueEndDate) {
        const end = new Date(queueEndDate + 'T23:59:59');
        if (itemDate > end) return false;
      }
    }

    return true;
  });

  const queueStats = {
    total: emailQueue.length,
    enviados: emailQueue.filter(o => o.trackings?.email_enviado).length,
    pendentes: emailQueue.filter(o => !o.trackings?.email_enviado).length,
  };

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
      {/* ------------------------------------------------------------
          VISAO 1: DASHBOARD SELETOR DE LOJAS (CARDS GRID)
          ------------------------------------------------------------ */}
      {!activeStore ? (
        <div className="flex flex-col min-h-screen">
          {/* Header Superior */}
          <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-30">
            <div className="flex items-center justify-between px-6 h-16">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-950/50">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-base font-extrabold text-white leading-none">Rastreio.IO SaaS</h1>
                  <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider mt-0.5">Painel Gestor Multi-Loja</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-xs text-slate-400 hidden sm:inline-block font-medium">{session?.user?.email}</span>
                <button onClick={handleLogout} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </div>
          </header>

          {/* Conteúdo Principal do Dashboard de Lojas */}
          <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
            {/* Banner de Boas-Vindas & Métricas SaaS */}
            <div className="bg-gradient-to-r from-indigo-950/60 via-slate-900 to-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-2xl">
              <div>
                <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider mb-2 inline-block">
                  Plataforma SaaS Multi-Tenant
                </span>
                <h2 className="text-2xl font-extrabold text-white">Minhas Lojas Integradas</h2>
                <p className="text-xs text-slate-400 mt-1 max-w-xl">
                  Selecione uma loja para gerenciar pedidos, códigos de rastreio e fila de e-mails em um workspace isolado.
                </p>
              </div>

              <button
                onClick={() => setNewStoreModalOpen(true)}
                className="py-3 px-5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 rounded-xl text-xs font-bold text-white transition-all shadow-lg shadow-indigo-950/50 flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                Conectar Nova Loja Shopify
              </button>
            </div>

            {/* Grade de Cards de Lojas */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <Store className="w-4 h-4 text-indigo-400" />
                  Lojas Cadastradas ({stores.length})
                </h3>
                <button onClick={fetchStores} disabled={loadingStores} className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer">
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingStores ? 'animate-spin' : ''}`} />
                  Atualizar Lista
                </button>
              </div>

              {loadingStores ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
                  <span className="text-xs font-medium">Carregando suas lojas...</span>
                </div>
              ) : stores.length === 0 ? (
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
                  <Store className="w-10 h-10 text-slate-600 mx-auto" />
                  <p className="text-sm font-bold text-white">Nenhuma loja integrada ainda</p>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    Conecte sua primeira loja Shopify para começar a gerenciar os rastreios dos seus clientes.
                  </p>
                  <button
                    onClick={() => setNewStoreModalOpen(true)}
                    className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl inline-flex items-center gap-2 mt-2 cursor-pointer"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Integrar Loja Shopify
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {stores.map((s: any) => (
                    <div
                      key={s.id}
                      className="bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-2xl p-6 transition-all shadow-xl hover:shadow-indigo-950/30 flex flex-col justify-between space-y-5 group"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition-transform">
                            <Store className="w-5 h-5" />
                          </div>
                          <span
                            className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                              s.status === 'ativa'
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/15 text-amber-400'
                            }`}
                          >
                            {s.status}
                          </span>
                        </div>

                        <div>
                          <h4 className="font-extrabold text-white text-base group-hover:text-indigo-300 transition-colors leading-tight">
                            {s.nome_loja}
                          </h4>
                          <p className="text-xs font-mono text-indigo-400/80 mt-1 flex items-center gap-1.5">
                            <Globe className="w-3 h-3 text-slate-500" />
                            {s.shopify_domain}
                          </p>
                        </div>
                      </div>

                      <div className="border-t border-slate-800/80 pt-4 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase font-semibold">Total de Pedidos</p>
                          <p className="text-sm font-extrabold text-white mt-0.5">{s.total_pedidos || 0}</p>
                        </div>

                        <button
                          onClick={() => handleSelectStore(s)}
                          className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-950/50 transition-all flex items-center gap-1.5 group-hover:bg-indigo-500 cursor-pointer"
                        >
                          🚀 Acessar Painel
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </main>

          {/* Modal de Conectar/Adicionar Nova Loja */}
          {newStoreModalOpen && (
            <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                    <Store className="w-5 h-5 text-indigo-400" /> Integrar Nova Loja Shopify
                  </h3>
                  <button
                    onClick={() => {
                      setNewStoreModalOpen(false);
                      setNewStoreError(null);
                      setNewStoreSuccess(false);
                    }}
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    <X className="w-4.5 h-4.5" />
                  </button>
                </div>

                {/* Seletor de Abas Premium */}
                <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => { setNewStoreTab('oauth'); setNewStoreError(null); }}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      newStoreTab === 'oauth'
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900/50'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Conexão Automática (OAuth)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNewStoreTab('manual'); setNewStoreError(null); }}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      newStoreTab === 'manual'
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white hover:bg-slate-900/50'
                    }`}
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    Conexão Manual (Token Privado)
                  </button>
                </div>

                {/* Alertas de Erro ou Sucesso */}
                {newStoreError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-xl flex items-center gap-2">
                    <XCircle className="w-4 h-4 shrink-0" />
                    <span>{newStoreError}</span>
                  </div>
                )}
                {newStoreSuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-3 rounded-xl flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Loja configurada com sucesso! Redirecionando...</span>
                  </div>
                )}

                {/* Form Aba 1: OAuth Automático */}
                {newStoreTab === 'oauth' ? (
                  <form onSubmit={handleConnectShopifyOAuth} className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Conecte sua loja do modo mais rápido e seguro. Nós guiaremos você pela tela de autorização oficial da Shopify.
                      </p>
                    </div>

                    <div className="space-y-3.5">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Nome da Loja (Opcional)</label>
                        <input
                          type="text"
                          value={newStoreNome}
                          onChange={e => setNewStoreNome(e.target.value)}
                          placeholder="Ex: Minha Loja Fantástica"
                          className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-white text-xs outline-none transition-all"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Domínio Shopify (myshopify.com)</label>
                        <div className="relative">
                          <Globe className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                          <input
                            type="text"
                            required
                            value={newStoreDomain}
                            onChange={e => setNewStoreDomain(e.target.value)}
                            placeholder="sua-loja.myshopify.com"
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-white text-xs font-mono outline-none transition-all"
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 mt-1 block">Insira apenas o domínio original da loja, ex: minha-loja.myshopify.com ou apenas o subdomínio.</span>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-3 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => {
                          setNewStoreModalOpen(false);
                          setNewStoreError(null);
                          setNewStoreSuccess(false);
                        }}
                        className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 rounded-xl transition-colors cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={savingStore}
                        className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-xs font-bold text-white rounded-xl flex items-center gap-2 shadow-lg shadow-indigo-950/50 disabled:opacity-50 transition-all cursor-pointer"
                      >
                        {savingStore ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Conectando...
                          </>
                        ) : (
                          <>
                            <Zap className="w-3.5 h-3.5" />
                            Conectar via Shopify
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                ) : (
                  /* Form Aba 2: Conexão Manual */
                  <form onSubmit={handleAddStore} className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Insira as credenciais de um App Personalizado criado manualmente no painel da sua Shopify.
                      </p>
                    </div>

                    <div className="space-y-3.5">
                      <div className="grid grid-cols-2 gap-3.5">
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Nome da Loja</label>
                          <input
                            type="text"
                            required
                            value={newStoreNome}
                            onChange={e => setNewStoreNome(e.target.value)}
                            placeholder="Ex: Loja Matriz"
                            className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-white text-xs outline-none transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">CNPJ da Empresa (Opcional)</label>
                          <input
                            type="text"
                            value={newStoreCnpj}
                            onChange={e => setNewStoreCnpj(e.target.value)}
                            placeholder="00.000.000/0001-00"
                            className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-white text-xs outline-none transition-all"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Domínio Shopify (myshopify.com)</label>
                        <div className="relative">
                          <Globe className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                          <input
                            type="text"
                            required
                            value={newStoreDomain}
                            onChange={e => setNewStoreDomain(e.target.value)}
                            placeholder="exemplo.myshopify.com"
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-white text-xs font-mono outline-none transition-all"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Admin API Access Token (shpat_...)</label>
                        <div className="relative">
                          <Shield className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                          <input
                            type="password"
                            required
                            value={newStoreToken}
                            onChange={e => setNewStoreToken(e.target.value)}
                            placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-white text-xs font-mono outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-3 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => {
                          setNewStoreModalOpen(false);
                          setNewStoreError(null);
                          setNewStoreSuccess(false);
                        }}
                        className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 rounded-xl transition-colors cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={savingStore}
                        className="px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-xs font-bold text-white rounded-xl flex items-center gap-2 shadow-lg shadow-indigo-950/50 disabled:opacity-50 transition-all cursor-pointer"
                      >
                        {savingStore ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Salvando...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Salvar Loja Manualmente
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ------------------------------------------------------------
            VISAO 2: WORKSPACE DA LOJA COM SIDEBAR LATERAL FIXA
            ------------------------------------------------------------ */
        <div className="flex min-h-screen">
          {/* Sidebar Lateral Fixa (Esquerda) */}
          <aside className="w-64 bg-slate-900/90 border-r border-slate-800 flex flex-col justify-between shrink-0 sticky top-0 h-screen z-20">
            <div className="p-4 space-y-5">
              {/* Botão de Trocar / Voltar para Minhas Lojas */}
              <button
                onClick={() => setActiveStore(null)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-950 border border-slate-800 hover:border-slate-700 hover:bg-slate-800 rounded-xl text-xs font-bold text-slate-300 transition-all cursor-pointer shadow-sm group"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-indigo-400 group-hover:-translate-x-0.5 transition-transform" />
                Voltar para Minhas Lojas
              </button>

              {/* Informações da Loja Ativa */}
              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-3.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white shrink-0 shadow-md">
                  <Store className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-extrabold text-white truncate leading-tight">{activeStore?.nome_loja || 'Minha Loja'}</p>
                  <p className="text-[10px] font-mono text-indigo-400 truncate mt-0.5">{activeStore?.shopify_domain || ''}</p>
                </div>
              </div>

              {/* Menu de Navegação da Sidebar */}
              <nav className="space-y-1">
                <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Workspace</p>
                {[
                  { key: 'pedidos',   label: 'Pedidos & Rastreio', icon: Package },
                  { key: 'fila',      label: 'Fila de E-mails',    icon: Mail },
                  { key: 'ai_agent',  label: 'Agente de IA',       icon: Bot },
                  { key: 'analytics', label: 'Analytics Logísticos', icon: BarChart3 },
                  { key: 'settings',  label: 'Configurações Loja', icon: Store },
                  { key: 'members',   label: 'Membros da Loja',    icon: Users },
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setActiveTab(key as any);
                      if (key === 'ai_agent') fetchAiConversations();
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      activeTab === key
                        ? 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-950/40'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" />
                      <span>{label}</span>
                    </div>
                    {key === 'fila' && queueStats.pendentes > 0 && (
                      <span className="bg-amber-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                        {queueStats.pendentes}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </div>

            {/* Rodapé da Sidebar */}
            <div className="p-4 border-t border-slate-800/80 bg-slate-950/40">
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <p className="text-[11px] font-bold text-white truncate">{session?.user?.email}</p>
                  <p className="text-[9px] text-slate-500">Lojista / Admin</p>
                </div>
                <button onClick={handleLogout} className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white cursor-pointer">
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </aside>

          {/* Área Principal de Conteúdo do Workspace */}
          <main className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-y-auto">
            {/* Cabeçalho do Conteúdo */}
            <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md px-6 py-3.5 flex items-center justify-between sticky top-0 z-10">
              <div>
                <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
                  {activeTab === 'pedidos' && '📦 Gestão de Pedidos & Códigos de Rastreio'}
                  {activeTab === 'fila' && '✉️ Fila de Notificações por E-mail'}
                  {activeTab === 'ai_agent' && '🤖 Agente de IA · Recuperação de Vendas & Suporte'}
                  {activeTab === 'analytics' && '📊 Analytics Logísticos da Loja'}
                  {activeTab === 'settings' && '⚙️ Configurações da Loja Shopify'}
                  {activeTab === 'members' && '👥 Membros e Acessos da Loja'}
                </h2>
                <p className="text-[10px] text-slate-400">Loja ativa: <span className="text-indigo-400 font-bold">{activeStore?.nome_loja || 'Loja'}</span></p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => fetchOrders(activeStore?.id)}
                  disabled={loadingOrders}
                  className="px-3 py-1.5 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingOrders ? 'animate-spin' : ''}`} />
                  Atualizar Dados
                </button>
              </div>
            </header>

      {/* ----------- TAB: PEDIDOS ----------- */}
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

              <button onClick={() => setShowManualOrderModal(true)}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700/60 rounded-xl text-xs font-semibold text-slate-200 transition-all shadow-md cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> Criar Encomenda Manual (Teste)
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
                <button onClick={() => fetchOrders()} disabled={loadingOrders}
                  className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-xl text-slate-400 disabled:opacity-55">
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
        </div>
      )}

      {/* ----------- TAB: FILA DE E-MAILS ----------- */}
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

            {/* Banner de Ação em Lote */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
              <div>
                <p className="text-xs font-bold text-white flex items-center gap-2">
                  <Send className="w-4 h-4 text-indigo-400" />
                  Disparo em Massa de Rastreio + Nota Fiscal
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Envie automaticamente e-mails de rastreamento e comprovantes de compra para pedidos pendentes.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => handleSendBatchEmails('exceto_hoje', 'nota')}
                  disabled={batchSending}
                  className="flex-1 sm:flex-none py-2 px-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 rounded-xl text-xs font-bold text-white transition-all shadow-md shadow-emerald-950/40 flex items-center justify-center gap-1.5 cursor-pointer"
                  title="Envia apenas as Notas Fiscais de pedidos criados até ontem que ainda NÃO foram enviadas (sem duplicar)."
                >
                  {batchSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-emerald-200" />}
                  📄 Notas de Ontem (Apenas Pendentes)
                </button>

                <button
                  onClick={() => handleSendBatchEmails('exceto_hoje')}
                  disabled={batchSending}
                  className="flex-1 sm:flex-none py-2 px-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 rounded-xl text-xs font-bold text-white transition-all shadow-md shadow-indigo-950/40 flex items-center justify-center gap-1.5"
                >
                  {batchSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-300" />}
                  Disparar (Exceto Pedidos de Hoje)
                </button>

                <button
                  onClick={() => handleSendBatchEmails('pendentes')}
                  disabled={batchSending}
                  className="flex-1 sm:flex-none py-2 px-3.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-xl text-xs font-bold text-slate-200 transition-colors flex items-center justify-center gap-1.5 border border-slate-700"
                >
                  🚀 Todos Pendentes
                </button>
              </div>
            </div>

            {batchProgress && (
              <div className="p-4 bg-slate-900 border border-indigo-500/40 rounded-2xl space-y-3 animate-in fade-in shadow-2xl">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                    Enviando E-mails em Tempo Real...
                  </span>
                  <span className="font-mono text-indigo-400 font-bold">
                    {batchProgress.atual} / {batchProgress.total} ({batchProgress.percentual}%)
                  </span>
                </div>

                <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800 p-0.5">
                  <div
                    className="bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 h-full transition-all duration-300 rounded-full"
                    style={{ width: `${batchProgress.percentual}%` }}
                  />
                </div>

                <p className="text-[11px] text-slate-300 font-medium truncate flex items-center gap-1.5 bg-slate-950/60 p-2 rounded-xl border border-slate-800">
                  <Send className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">{batchProgress.statusLog}</span>
                </p>
              </div>
            )}

            {batchResult && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 text-center font-semibold animate-in fade-in">
                {batchResult}
              </div>
            )}

            {/* Filtros + Pesquisa + Período */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-4 shadow-md">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                
                {/* Abas de status de envio */}
                <div className="flex gap-1 bg-slate-950 border border-slate-800/80 rounded-xl p-1 shrink-0 w-fit">
                  {(['todos', 'enviados', 'pendentes'] as const).map(f => (
                    <button key={f} onClick={() => setQueueFilter(f)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                        queueFilter === f ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}>
                      {f}
                    </button>
                  ))}
                </div>

                {/* Filtro por Período */}
                <div className="flex items-center gap-2 flex-wrap text-slate-300">
                  <span className="text-xs text-slate-500 font-medium">Período:</span>
                  <input 
                    type="date" 
                    value={queueStartDate}
                    onChange={e => setQueueStartDate(e.target.value)}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                  />
                  <span className="text-xs text-slate-600">até</span>
                  <input 
                    type="date" 
                    value={queueEndDate}
                    onChange={e => setQueueEndDate(e.target.value)}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                  />
                  {(queueStartDate || queueEndDate) && (
                    <button 
                      onClick={() => { setQueueStartDate(''); setQueueEndDate(''); }}
                      className="text-[10px] font-bold text-rose-400 hover:text-rose-300 transition-colors bg-rose-500/10 px-2 py-1 rounded-lg border border-rose-500/10 cursor-pointer"
                    >
                      Limpar datas
                    </button>
                  )}
                </div>

                {/* Botão de atualizar */}
                <button onClick={() => fetchEmailQueue(false)} disabled={loadingQueue}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 disabled:opacity-50 rounded-xl text-xs text-slate-300 transition-all font-semibold shrink-0 cursor-pointer ml-auto md:ml-0">
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingQueue ? 'animate-spin' : ''}`} />
                  Atualizar
                </button>
              </div>

              {/* Barra de Pesquisa de Texto */}
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Pesquisar por nome do cliente, e-mail, número do pedido ou código de rastreamento..."
                  value={queueSearch}
                  onChange={e => setQueueSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-950/80 border border-slate-800/80 rounded-xl text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500 transition-all"
                />
                {queueSearch && (
                  <button 
                    onClick={() => setQueueSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs font-bold font-sans cursor-pointer bg-slate-800 px-1.5 py-0.5 rounded"
                  >
                    X
                  </button>
                )}
              </div>
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
                        <th className="px-4 py-3 text-center font-semibold">Rastreio</th>
                        <th className="px-4 py-3 text-center font-semibold">Nota Fiscal</th>
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
                            {item.nota_enviada
                              ? <div className="flex items-center justify-center gap-1 text-emerald-400 font-bold" title="Nota Fiscal enviada ao cliente">
                                  <CheckCircle2 className="w-4 h-4" />
                                </div>
                              : <div className="flex items-center justify-center gap-1 text-slate-600" title="Nota Fiscal pendente de envio">
                                  <XCircle className="w-4 h-4" />
                                </div>}
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
                            {!item.trackings?.email_enviado || !item.nota_enviada ? (
                              <button onClick={() => handleSendNotification('ambos', item.id)}
                                disabled={resendingId === item.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-[10px] font-semibold text-white transition-colors mx-auto cursor-pointer">
                                {resendingId === item.id
                                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Enviando...</>
                                  : <><Send className="w-3 h-3" /> Enviar</>}
                              </button>
                            ) : (
                              <button onClick={() => handleSendNotification('ambos', item.id)}
                                disabled={resendingId === item.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg text-[10px] font-semibold text-slate-400 transition-colors mx-auto cursor-pointer">
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

      {/* ----------- TAB DEDICADA: AGENTE DE IA & RECUPERAÇÃO DE VENDAS ----------- */}
      {activeTab === 'ai_agent' && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            
            {/* Cards de Métricas em Destaque (KPIs de Recuperação) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Leads Contatados</p>
                  <p className="text-lg font-extrabold text-white mt-0.5">{aiMetrics.total_contatados}</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Leads Engajados</p>
                  <p className="text-lg font-extrabold text-white mt-0.5">{aiMetrics.total_engajados}</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Vendas Salvas</p>
                  <p className="text-lg font-extrabold text-emerald-400 mt-0.5">{aiMetrics.total_convertidos}</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">R$ Recuperados</p>
                  <p className="text-lg font-extrabold text-amber-400 mt-0.5">R$ {aiMetrics.faturamento_recuperado.toFixed(2)}</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-xl flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 shrink-0">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Taxa Conversão</p>
                  <p className="text-lg font-extrabold text-violet-400 mt-0.5">{aiMetrics.taxa_conversao}%</p>
                </div>
              </div>
            </div>

            {/* Banner de Status e Toggle Principal */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-80 h-80 bg-violet-600/10 rounded-full filter blur-3xl -z-0 pointer-events-none" />
              
              <div className="flex items-center gap-4 z-10">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-xl shadow-indigo-950/60 shrink-0">
                  <Bot className="w-7 h-7" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-extrabold text-white">Agente de IA Autônomo para WhatsApp</h2>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30 uppercase tracking-wider">
                      Evolution API
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 max-w-xl">
                    Sua IA atende clientes 24/7 no WhatsApp, tira dúvidas logísticas de pedidos e recupera vendas com cupons exclusivos.
                  </p>
                </div>
              </div>

              <div className="z-10 flex items-center gap-3 bg-slate-950/80 border border-slate-800 p-3 rounded-2xl">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aiRecoveryEnabled}
                    onChange={e => setAiRecoveryEnabled(e.target.checked)}
                    className="w-5 h-5 rounded text-violet-600 bg-slate-900 border-slate-700 focus:ring-violet-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-bold text-white block">
                      {aiRecoveryEnabled ? '⚡ Agente de IA Ativo' : '⏸️ Agente Desativado'}
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      {aiRecoveryEnabled ? 'Respondendo mensagens automaticamente' : 'Clique para ligar o atendimento autônomo'}
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Painel de Configurações Avançadas do LLM */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-400">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-white">Parâmetros & Modelo de Inteligência Artificial</h3>
                    <p className="text-xs text-slate-400">Personalize o comportamento, tom de voz e criatividade do LLM</p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-6">
                {settingsSuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-3.5 rounded-xl flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> Configurações do Agente de IA salvas com sucesso!
                  </div>
                )}

                {/* Seletores de Modelo, Tom e Criatividade em Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Seletor de Modelo */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Modelo LLM
                    </label>
                    <select
                      value={aiModel}
                      onChange={e => setAiModel(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-semibold focus:ring-2 focus:ring-violet-500 focus:outline-none"
                    >
                      <option value="gpt-4o-mini">⚡ OpenAI GPT-4o-mini (Rápido e Econômico)</option>
                      <option value="gpt-4o">🧠 OpenAI GPT-4o (Máxima Persuasão)</option>
                      <option value="gemini-1.5-flash">✨ Google Gemini 1.5 Flash (Ultrarrápido)</option>
                    </select>
                    <span className="text-[10px] text-slate-500 mt-1 block">Escolha a capacidade de raciocínio da IA.</span>
                  </div>

                  {/* Seletor de Tom de Voz */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                      Tom de Voz do Atendimento
                    </label>
                    <select
                      value={aiTone}
                      onChange={e => setAiTone(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-semibold focus:ring-2 focus:ring-violet-500 focus:outline-none"
                    >
                      <option value="amigavel">😊 Amigável & Descontraído</option>
                      <option value="vendedor">🎯 Vendedor & Persuasivo (Foco em Oferta)</option>
                      <option value="formal">👔 Formal & Profissional</option>
                      <option value="empatico">💖 Empático & Atencioso (Resolução de Calma)</option>
                    </select>
                    <span className="text-[10px] text-slate-500 mt-1 block">Estilo de linguagem no WhatsApp.</span>
                  </div>

                  {/* Slider de Temperatura / Criatividade */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Criatividade (Temperatura)
                      </label>
                      <span className="text-xs font-mono font-bold text-violet-400">{aiTemperature}</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.1"
                      value={aiTemperature}
                      onChange={e => setAiTemperature(parseFloat(e.target.value))}
                      className="w-full h-2 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-violet-500"
                    />
                    <div className="flex justify-between text-[9px] text-slate-500 mt-1 font-semibold">
                      <span>0.1 (Exato/Rígido)</span>
                      <span>0.7 (Equilibrado)</span>
                      <span>1.0 (Criativo)</span>
                    </div>
                  </div>
                </div>

                {/* Cupom Automático e Chave OpenAI */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800/80">
                  <SettingsInput
                    label="Cupom de Desconto Automático (Opcional)"
                    value={aiCouponCode}
                    onChange={setAiCouponCode}
                    placeholder="EX: RESGATE10"
                    hint="Cupom que a IA oferecerá aos clientes com dúvidas para fechar o pedido."
                  />
                  <SettingsInput
                    label="Chave de API OpenAI da Loja (OpenAI Key)"
                    value={openaiApiKey}
                    onChange={setOpenaiApiKey}
                    placeholder="sk-proj-xxxxxxxxxxxx"
                    type="password"
                    mono
                    hint="Caso deseje utilizar sua própria chave da OpenAI."
                  />
                </div>

                {/* Editor do Prompt de Instruções da IA com Tags Rápidas */}
                <div className="pt-4 border-t border-slate-800/80 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                        Instruções Personalizadas do Lojista (Prompt)
                      </label>
                      <span className="text-[10px] text-slate-500 block">Escreva orientações específicas para a IA responder sobre sua marca.</span>
                    </div>

                    {/* Botões Rápidos de Inserção de Tags */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-slate-500 font-bold mr-1">Inserir Tag:</span>
                      {[
                        { tag: '{NOME_CLIENTE}', label: 'Cliente' },
                        { tag: '{NUMERO_PEDIDO}', label: 'Pedido' },
                        { tag: '{LINK_RASTREIO}', label: 'Rastreio' },
                        { tag: '{CUPOM_DESCONTO}', label: 'Cupom' },
                      ].map(({ tag, label }) => (
                        <button
                          type="button"
                          key={tag}
                          onClick={() => setAiPromptCustom(prev => `${prev} ${tag}`)}
                          className="px-2 py-1 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-[10px] font-mono text-violet-400 font-bold transition-colors cursor-pointer"
                        >
                          +{label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <textarea
                    rows={5}
                    value={aiPromptCustom}
                    onChange={e => setAiPromptCustom(e.target.value)}
                    placeholder="Exemplo: Olá {NOME_CLIENTE}! Sou o assistente da loja. Vi que seu pedido {NUMERO_PEDIDO} foi postado. Se tiver dúvidas use o link {LINK_RASTREIO} ou aproveite nosso cupom {CUPOM_DESCONTO} para novos itens!"
                    className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs font-sans focus:ring-2 focus:ring-violet-500 focus:outline-none leading-relaxed"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-xl shadow-indigo-950/50 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Salvar Configurações do Agente de IA
                </button>
              </form>
            </div>

            {/* Tabela / Histórico de Conversas da IA no WhatsApp */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-white">Histórico de Atendimentos do Bot</h3>
                    <p className="text-xs text-slate-400">Mensagens recentes trocadas pela IA no WhatsApp com os compradores</p>
                  </div>
                </div>

                <button
                  onClick={fetchAiConversations}
                  disabled={loadingAiConversations}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-800 hover:bg-slate-800 rounded-xl text-xs text-slate-300 flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingAiConversations ? 'animate-spin' : ''}`} />
                  Atualizar Conversas
                </button>
              </div>

              {loadingAiConversations ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-violet-500 mb-2" />
                  <span className="text-xs">Carregando conversas do WhatsApp...</span>
                </div>
              ) : aiConversations.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  Nenhuma conversa registrada pela IA até o momento. As interações aparecerão aqui assim que o webhook da Evolution API receber chamadas.
                </div>
              ) : (
                <div className="space-y-3">
                  {aiConversations.map((conv: any) => (
                    <div key={conv.id} className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs border-b border-slate-800/60 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{conv.customer_name || 'Cliente WhatsApp'}</span>
                          <span className="font-mono text-slate-400">({conv.customer_phone})</span>
                        </div>
                        <span className="text-[10px] text-slate-500">
                          {new Date(conv.created_at).toLocaleString('pt-BR')}
                        </span>
                      </div>

                      <div className="space-y-2 pt-1 text-xs">
                        {Array.isArray(conv.mensagens) && conv.mensagens.map((msg: any, mIdx: number) => (
                          <div key={mIdx} className={`flex ${msg.sender === 'customer' ? 'justify-start' : 'justify-end'}`}>
                            <div className={`max-w-[80%] p-3 rounded-2xl ${
                              msg.sender === 'customer'
                                ? 'bg-slate-900 border border-slate-800 text-slate-200'
                                : 'bg-violet-600/20 border border-violet-500/30 text-violet-200'
                            }`}>
                              <span className="text-[9px] font-bold block uppercase tracking-wider mb-0.5 opacity-70">
                                {msg.sender === 'customer' ? '👤 Cliente' : '🤖 Agente de IA'}
                              </span>
                              <p className="leading-relaxed">{msg.text}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ----------- TAB: ANALYTICS & IA ----------- */}
      {activeTab === 'analytics' && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Header de Métricas Operacionais */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Tempo Médio Entrega</p>
                  <p className="text-xl font-extrabold text-white mt-0.5">3.8 Dias</p>
                  <p className="text-[10px] text-emerald-400 font-semibold mt-0.5">↓ 12% mais rápido</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Taxa de Sucesso</p>
                  <p className="text-xl font-extrabold text-white mt-0.5">97.8%</p>
                  <p className="text-[10px] text-emerald-400 font-semibold mt-0.5">Sem extravios este mês</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Retenção / Atenção</p>
                  <p className="text-xl font-extrabold text-white mt-0.5">2 Pedidos</p>
                  <p className="text-[10px] text-amber-400 font-semibold mt-0.5">Aguardando retentativa</p>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Vendas Salvas pela IA</p>
                  <p className="text-xl font-extrabold text-white mt-0.5">14 Recuperações</p>
                  <p className="text-[10px] text-violet-400 font-semibold mt-0.5">via Evolution WhatsApp</p>
                </div>
              </div>
            </div>

            {/* Painel do Agente de IA para Recuperação de Vendas */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                      Agente de IA Autônomo · Recuperação de Vendas
                    </h3>
                    <p className="text-xs text-slate-400">Atendimento e conversão automática no WhatsApp da loja</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl">
                  <div className={`w-2.5 h-2.5 rounded-full ${aiRecoveryEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
                  <span className="text-xs font-bold text-slate-300">
                    {aiRecoveryEnabled ? 'Agente de IA Ativo' : 'Agente Desativado'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 space-y-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Gatilho de Ação</span>
                  <p className="font-bold text-white">Webhook da Evolution API</p>
                  <p className="text-slate-400 text-[11px]">Responde automaticamente mensagens de clientes com dúvidas ou objeções.</p>
                </div>

                <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 space-y-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Modelo LLM</span>
                  <p className="font-bold text-indigo-400">OpenAI GPT-4o-mini</p>
                  <p className="text-slate-400 text-[11px]">Treinado com o contexto do pedido, código de rastreio e instrução do lojista.</p>
                </div>

                <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-4 space-y-1">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Último Disparo</span>
                  <p className="font-bold text-emerald-400">Há 15 minutos</p>
                  <p className="text-slate-400 text-[11px]">Dúvida sobre entrega em São Paulo resolvida com sucesso.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ----------- TAB: CONFIGURACOES ----------- */}
      {activeTab === 'settings' && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-3xl mx-auto space-y-5">

            {loadingSettings ? (
              <div className="py-20 flex flex-col items-center text-slate-500">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500 mb-2" />
                <span className="text-xs">Carregando configurações...</span>
              </div>
            ) : (
              <form onSubmit={handleSaveSettings} className="space-y-5">

                {settingsSuccess && <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs p-3.5 rounded-xl flex items-center gap-2 font-semibold">✅ Configurações salvas com sucesso!</div>}
                {settingsError && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3.5 rounded-xl flex items-center gap-2 font-semibold">❌ {settingsError}</div>}

                {/* ═══════ CARD 1: Shopify ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-emerald-600/10 to-teal-600/5 border-b border-slate-800 flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"><Store className="w-5 h-5" /></div>
                    <div>
                      <h3 className="text-sm font-extrabold text-white">Integração Shopify</h3>
                      <p className="text-[10px] text-slate-400">Credenciais do App Privado na Shopify</p>
                    </div>
                  </div>
                  <div className="p-6 space-y-4">
                    <SettingsInput label="URL Base da Aplicação" value={nextPublicAppUrl} onChange={setNextPublicAppUrl} placeholder="https://rastreio-io.vercel.app" hint="URL onde o sistema está hospedado." />
                    <SettingsInput label="Shopify App Client ID (API Key)" value={shopifyClientId} onChange={setShopifyClientId} placeholder="Cole o Client ID gerado no Shopify Partners" mono hint="Necessário para a integração via OAuth." />
                    <SettingsInput label="Shopify App Client Secret" value={shopifyClientSecret} onChange={setShopifyClientSecret} placeholder="Cole o Client Secret gerado no Shopify Partners" type="password" mono hint="Necessário para troca de autorização OAuth." />
                    <hr className="border-slate-800 my-2" />
                    <SettingsInput label="Domínio da Loja Principal (Legacy)" value={shopifyDomain} onChange={setShopifyDomain} placeholder="exemplo.myshopify.com" hint="Insira apenas o subdomínio myshopify.com." />
                    <SettingsInput label="Token de Acesso Admin API (Legacy)" value={shopifyToken} onChange={setShopifyToken} placeholder="shpat_xxxx" type="password" mono hint="Requer escopos read_orders e write_orders." />
                    <SettingsInput label="Segredo do Webhook" value={shopifyWebhookSecret} onChange={setShopifyWebhookSecret} placeholder="Segredo de validação HMAC" type="password" mono />
                    
                    <div className="pt-2 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleConnectOAuth}
                        className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs font-extrabold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer border border-emerald-500/30"
                      >
                        ⚡ Conectar via OAuth (Instalar App Shopify)
                      </button>
                      <p className="text-[10px] text-slate-500 text-center">Inicia a instalação automatizada usando as chaves configuradas acima.</p>
                    </div>
                  </div>
                </div>

                {/* ═══════ CARD 2: Jornada de Rastreio ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-indigo-600/10 to-violet-600/5 border-b border-slate-800 flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/20"><Clock className="w-5 h-5" /></div>
                    <div>
                      <h3 className="text-sm font-extrabold text-white">Simulação da Jornada de Rastreio</h3>
                      <p className="text-[10px] text-slate-400">Dias de espera em cada status para exibição ao cliente</p>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-3 gap-3">
                      <SettingsInput label="Postado → Trânsito" value={delayPostadoEmTransito} onChange={setDelayPostadoEmTransito} type="number" hint="dias" />
                      <SettingsInput label="Trânsito → Saiu" value={delayEmTransitoSaiuEntrega} onChange={setDelayEmTransitoSaiuEntrega} type="number" hint="dias" />
                      <SettingsInput label="Saiu → Entregue" value={delaySaiuEntregaEntregue} onChange={setDelaySaiuEntregaEntregue} type="number" hint="dias" />
                    </div>
                  </div>
                </div>

                {/* ═══════ CARD 3: Automação de E-mails ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-amber-600/10 to-orange-600/5 border-b border-slate-800 flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/20"><Zap className="w-5 h-5" /></div>
                    <div>
                      <h3 className="text-sm font-extrabold text-white">Automação de E-mails Agendados</h3>
                      <p className="text-[10px] text-slate-400">Prazos para disparo automático de Nota Fiscal e Rastreio</p>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SettingsInput label="Envio da Nota Fiscal (Horas após compra)" value={notaDelayHoras} onChange={setNotaDelayHoras} type="number" hint="Padrão: 2h." />
                      <div className="p-3.5 bg-slate-950/60 border border-slate-800/80 rounded-xl flex flex-col justify-center">
                        <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">📅 Envio de Rastreio ao Lead</span>
                        <span className="text-[11px] text-slate-400 mt-1">Disparado no <strong>Próximo Dia Útil</strong> (pula finais de semana).</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ═══════ CARD 4: Dados Fiscais ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-sky-600/10 to-cyan-600/5 border-b border-slate-800 flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/20"><FileText className="w-5 h-5" /></div>
                    <div>
                      <h3 className="text-sm font-extrabold text-white">Dados Fiscais / Nota de Compra</h3>
                      <p className="text-[10px] text-slate-400">Dados da empresa impressos na nota fiscal de compra</p>
                    </div>
                  </div>
                  <div className="p-6 space-y-4">
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
                </div>

                {/* ═══════ CARD 5: Taxa de Despacho ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-rose-600/10 to-pink-600/5 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/20"><AlertTriangle className="w-5 h-5" /></div>
                      <div>
                        <h3 className="text-sm font-extrabold text-white">Taxa de Despacho Postal & Retentativas</h3>
                        <p className="text-[10px] text-slate-400">Regras para tentativas de entrega e cobrança de taxa</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" checked={taxaEnabled} onChange={e => setTaxaEnabled(e.target.checked)} className="sr-only peer" />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
                    </label>
                  </div>
                  {taxaEnabled && (
                    <div className="p-6 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingsInput label="Dias das 3 Retentativas" value={taxaDiasTentativas} onChange={setTaxaDiasTentativas} placeholder="9,10,11" hint="Dias após a compra para tentativas não atendidas." />
                        <SettingsInput label="Dia para Exibir Alerta & Botão" value={taxaDiaExibicao} onChange={setTaxaDiaExibicao} type="number" hint="Dia a partir do qual a caixa de pagamento surge (Padrão: 11)." />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingsInput label="Nome/Título da Taxa" value={taxaNome} onChange={setTaxaNome} placeholder="Taxa de Despacho Postal" />
                        <SettingsInput label="Valor da Taxa (R$)" value={taxaValor} onChange={setTaxaValor} placeholder="27.90" />
                      </div>
                      <SettingsInput label="Link da Página de Pagamento (Checkout Externo)" value={taxaLinkPagamento} onChange={setTaxaLinkPagamento} placeholder="https://checkout.sualoja.com/taxa" hint="URL de redirecionamento quando o checkout VeoPag não está ativo." />
                    </div>
                  )}
                </div>

                {/* ═══════ CARD 6: VeoPag Checkout Pix ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-emerald-600/10 to-green-600/5 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">💳</div>
                      <div>
                        <h3 className="text-sm font-extrabold text-white">Checkout Pix Integrado (VeoPag)</h3>
                        <p className="text-[10px] text-slate-400">Cliente paga a taxa direto na página de rastreio via Pix</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" checked={veopagEnabled} onChange={e => setVeopagEnabled(e.target.checked)} className="sr-only peer" />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                    </label>
                  </div>
                  {veopagEnabled && (
                    <div className="p-6 space-y-4">
                      <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl text-[11px] text-emerald-300 font-medium">
                        Quando ativado, o botão &quot;Pagar Taxa&quot; abre o checkout integrado com QR Code Pix diretamente na página de rastreio, ao invés de redirecionar para o link externo.
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingsInput label="VeoPag Client ID" value={veopagClientId} onChange={setVeopagClientId} placeholder="minhaloja_ABCD1234" hint="ID do cliente fornecido pela VeoPag." />
                        <SettingsInput label="VeoPag Client Secret" value={veopagClientSecret} onChange={setVeopagClientSecret} placeholder="seu_client_secret" type="password" mono hint="Chave secreta de acesso à API." />
                      </div>
                    </div>
                  )}
                </div>

                {/* ═══════ CARD 7: Banner de Upsell ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-violet-600/10 to-purple-600/5 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-violet-500/15 text-violet-400 border border-violet-500/20"><ShoppingBag className="w-5 h-5" /></div>
                      <div>
                        <h3 className="text-sm font-extrabold text-white">Banner de Upsell & Recompra</h3>
                        <p className="text-[10px] text-slate-400">Oferta especial com cupom na tela de rastreamento</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" checked={upsellEnabled} onChange={e => setUpsellEnabled(e.target.checked)} className="sr-only peer" />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                    </label>
                  </div>
                  {upsellEnabled && (
                    <div className="p-6 space-y-4">
                      <SettingsInput label="Título da Oferta" value={upsellTitle} onChange={setUpsellTitle} placeholder="Ganhe 15% OFF na próxima compra!" />
                      <SettingsInput label="Descrição / Cupom" value={upsellDescription} onChange={setUpsellDescription} placeholder="Use o cupom CLIENTE15 no checkout." />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <SettingsInput label="Link do Botão" value={upsellLink} onChange={setUpsellLink} placeholder="https://minhaloja.com/oferta" />
                        <SettingsInput label="URL da Imagem (Opcional)" value={upsellImageUrl} onChange={setUpsellImageUrl} placeholder="https://minhaloja.com/produto.jpg" />
                      </div>
                    </div>
                  )}
                </div>

                {/* ═══════ CARD 8: White-Label ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-fuchsia-600/10 to-pink-600/5 border-b border-slate-800 flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/20"><Palette className="w-5 h-5" /></div>
                    <div>
                      <h3 className="text-sm font-extrabold text-white">Personalização White-Label</h3>
                      <p className="text-[10px] text-slate-400">Identidade visual da sua marca na página de rastreio</p>
                    </div>
                  </div>
                  <div className="p-6 space-y-4">
                    <SettingsInput label="URL do Logotipo da Loja" value={logoUrl} onChange={setLogoUrl} placeholder="https://minhaloja.com/logo.png" hint="PNG ou SVG com fundo transparente." />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Cor Tema da Marca</label>
                        <div className="flex items-center gap-3">
                          <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer p-1" />
                          <input type="text" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="flex-1 px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white font-mono text-sm uppercase" />
                        </div>
                      </div>
                      <SettingsInput label="WhatsApp de Suporte" value={whatsappSuporte} onChange={setWhatsappSuporte} placeholder="5511999999999" hint="Número com DDD para botão de ajuda." />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SettingsInput label="Banner Promocional (URL)" value={bannerUrl} onChange={setBannerUrl} placeholder="https://minhaloja.com/banner.jpg" hint="Imagem no rodapé do rastreio." />
                      <SettingsInput label="Link de Destino do Banner" value={bannerLink} onChange={setBannerLink} placeholder="https://minhaloja.com/colecao-nova" />
                    </div>
                  </div>
                </div>

                {/* ═══════ CARD 9: E-mail (Resend) ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-blue-600/10 to-indigo-600/5 border-b border-slate-800 flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-blue-500/15 text-blue-400 border border-blue-500/20"><Mail className="w-5 h-5" /></div>
                    <div>
                      <h3 className="text-sm font-extrabold text-white">Serviço de E-mail (Resend)</h3>
                      <p className="text-[10px] text-slate-400">Credenciais para envio automatizado de e-mails</p>
                    </div>
                  </div>
                  <div className="p-6 space-y-4">
                    <SettingsInput label="Resend API Key" value={resendApiKey} onChange={setResendApiKey} placeholder="re_xxxxxxxxx" type="password" mono hint="Chave de API do painel Resend." />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SettingsInput label="E-mail de Remetente (From)" value={resendFromEmail} onChange={setResendFromEmail} placeholder="Rastreio <noreply@seudominio.com>" hint="Formato: Nome <email@dominio.com>" />
                      <SettingsInput label="URL Pública do App" value={nextPublicAppUrl} onChange={setNextPublicAppUrl} placeholder="https://seudominio.com" hint="Usada para gerar os links de rastreio." />
                    </div>
                  </div>
                </div>

                {/* ═══════ CARD 10: OpenAI ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-teal-600/10 to-emerald-600/5 border-b border-slate-800 flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-teal-500/15 text-teal-400 border border-teal-500/20"><Sparkles className="w-5 h-5" /></div>
                    <div>
                      <h3 className="text-sm font-extrabold text-white">Assistente Virtual de IA (OpenAI)</h3>
                      <p className="text-[10px] text-slate-400">Chave da OpenAI para o Chatbot do Rastreio</p>
                    </div>
                  </div>
                  <div className="p-6">
                    <SettingsInput label="OpenAI API Key" value={openaiApiKey} onChange={setOpenaiApiKey} placeholder="sk-proj-xxxxxxxx" type="password" mono hint="Permite responder dúvidas dos clientes em tempo real." />
                  </div>
                </div>

                {/* ═══════ CARD 11: WhatsApp (Evolution API) ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-green-600/10 to-lime-600/5 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-green-500/15 text-green-400 border border-green-500/20"><MessageSquare className="w-5 h-5" /></div>
                      <div>
                        <h3 className="text-sm font-extrabold text-white">WhatsApp (Evolution API)</h3>
                        <p className="text-[10px] text-slate-400">Disparo automático de mensagens ao cliente</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" checked={whatsappEnabled} onChange={e => setWhatsappEnabled(e.target.checked)} className="sr-only peer" />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                    </label>
                  </div>
                  <div className="p-6 space-y-4">
                    <SettingsInput label="Evolution API URL" value={evolutionApiUrl} onChange={setEvolutionApiUrl} placeholder="https://api.evolution.suaempresa.com" hint="Endereço base do seu servidor." />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <SettingsInput label="API Key" value={evolutionApiKey} onChange={setEvolutionApiKey} placeholder="Chave de API" type="password" mono />
                      <SettingsInput label="Nome da Instância" value={evolutionInstanceName} onChange={setEvolutionInstanceName} placeholder="instancia-loja-01" hint="Instância conectada ao WhatsApp." />
                    </div>
                  </div>
                </div>

                {/* ═══════ CARD 12: Agente de IA (Recuperação) ═══════ */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                  <div className="px-6 py-4 bg-gradient-to-r from-violet-600/10 to-indigo-600/5 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-violet-500/15 text-violet-400 border border-violet-500/20"><Bot className="w-5 h-5" /></div>
                      <div>
                        <h3 className="text-sm font-extrabold text-white">Agente de IA (Recuperação de Vendas)</h3>
                        <p className="text-[10px] text-slate-400">IA que responde clientes no WhatsApp e converte pedidos</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" checked={aiRecoveryEnabled} onChange={e => setAiRecoveryEnabled(e.target.checked)} className="sr-only peer" />
                      <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
                    </label>
                  </div>
                  <div className="p-6 space-y-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Instruções Personalizadas do Agente (Prompt)</label>
                      <textarea
                        rows={4}
                        value={aiPromptCustom}
                        onChange={e => setAiPromptCustom(e.target.value)}
                        placeholder="Ex: Trate o cliente pelo primeiro nome, ofereça cupom de 5%..."
                        className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">Regras e diretrizes de atendimento da sua marca.</span>
                    </div>
                  </div>
                </div>

                {/* ═══════ BOTÃO SALVAR ═══════ */}
                <button type="submit" disabled={savingSettings}
                  className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 rounded-2xl text-sm font-extrabold text-white transition-all disabled:opacity-50 cursor-pointer shadow-xl shadow-indigo-950/40 flex items-center justify-center gap-2.5">
                  {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Salvar Todas as Configurações
                </button>
              </form>
            )}

            {/* ═══════ Zona de Perigo ═══════ */}
            {!loadingSettings && activeStore && (
              <div className="bg-slate-900 border border-red-950/40 rounded-2xl overflow-hidden shadow-xl">
                <div className="px-6 py-4 bg-gradient-to-r from-red-600/10 to-rose-600/5 border-b border-red-900/30 flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-red-500/15 text-red-400 border border-red-500/20"><AlertTriangle className="w-5 h-5" /></div>
                  <div>
                    <h3 className="text-sm font-extrabold text-white">Zona de Perigo</h3>
                    <p className="text-[10px] text-slate-400">Ações irreversíveis para esta loja</p>
                  </div>
                </div>
                <div className="p-6">
                  <div className="p-4 bg-red-950/10 border border-red-900/20 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold text-white">Desconectar e Excluir Loja</p>
                      <p className="text-[10px] text-slate-400 mt-1 max-w-md">
                        Isso apagará permanentemente a loja, pedidos, históricos e conversas.
                      </p>
                    </div>
                    <button type="button" onClick={() => activeStore?.id && handleDeleteStore(activeStore.id)}
                      className="py-2.5 px-4 bg-red-600/10 hover:bg-red-650 border border-red-500/20 hover:border-red-600 rounded-xl text-xs font-bold text-red-400 hover:text-white transition-all shrink-0 cursor-pointer shadow-sm">
                      Excluir Loja Permanentemente
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      )}


      {/* ----------- TAB: MEMBROS E ACESSOS ----------- */}
      {activeTab === 'members' && activeStore && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Membros & Acessos da Loja</h2>
                  <p className="text-xs text-slate-400">Vincule e-mails de lojistas para acessarem esta loja</p>
                </div>
              </div>

              <form onSubmit={handleInviteMember} className="flex flex-col sm:flex-row gap-3 mb-6">
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email.do.lojista@exemplo.com"
                  className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={invitingMember}
                  className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-bold text-white rounded-xl transition-colors flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                >
                  {invitingMember ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                  Vincular Lojista
                </button>
              </form>

              {inviteSuccess && (
                <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl font-semibold">
                  ✅ Usuário vinculado com sucesso à loja!
                </div>
              )}
              {inviteError && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl font-semibold">
                  {inviteError}
                </div>
              )}

              <div className="border border-slate-800 rounded-xl overflow-hidden">
                {loadingMembers ? (
                  <div className="p-8 text-center text-xs text-slate-500">Carregando membros...</div>
                ) : storeMembers.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">Nenhum lojista vinculado especificamente ainda. (Somente o Admin Master tem acesso).</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase tracking-wider bg-slate-950/50">
                        <th className="px-4 py-3 text-left font-semibold">Usuário (User ID)</th>
                        <th className="px-4 py-3 text-center font-semibold">Função</th>
                        <th className="px-4 py-3 text-center font-semibold">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {storeMembers.map((m: any) => (
                        <tr key={m.id}>
                          <td className="px-4 py-3 font-mono text-slate-300">{m.user_id}</td>
                          <td className="px-4 py-3 text-center">
                            <span className="bg-indigo-500/10 text-indigo-400 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                              {m.role || 'Lojista'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button onClick={() => handleRemoveMember(m.id)} className="text-red-400 hover:underline text-[10px]">
                              Remover
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
          </main>
        </div>
      )}

      {/* ----------- DETALHE DO PEDIDO: POPUP MODAL ----------- */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm transition-all animate-in fade-in duration-200">
          <div className="absolute inset-0" onClick={() => setSelectedOrder(null)} />
          
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl relative z-10 animate-in slide-in-from-bottom-6 duration-300">
            
            {loadingDetail ? (
              <>
                {/* Modal Header Skeleton */}
                <div className="p-5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between flex-shrink-0">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Detalhes do Pedido</span>
                    <div className="h-5 w-32 bg-slate-850 animate-pulse rounded-md mt-1" />
                  </div>
                  <button onClick={() => setSelectedOrder(null)} 
                    className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-slate-900 border border-slate-700/60 text-slate-400 hover:text-white transition-all shadow-md">
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
                {/* Spinner */}
                <div className="flex-1 flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  <span className="text-sm">Carregando detalhes do pedido...</span>
                </div>
              </>
            ) : (
              <>
                {/* Modal Header */}
                <div className="p-5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between flex-shrink-0">
                  <div>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Detalhes do Pedido</span>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2 mt-0.5">
                      #{selectedOrder.numero_pedido}
                      <StatusBadge status={selectedOrder.status_pedido} />
                      {selectedOrder.shopify_fulfillment_status === 'fulfilled' && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-semibold">Shopify: Fulfillment ✓</span>
                      )}
                      <span className="text-xs text-slate-500 font-normal">
                        {new Date(selectedOrder.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </h2>
                  </div>
                  <button onClick={() => setSelectedOrder(null)} 
                    className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-slate-900 border border-slate-700/60 text-slate-400 hover:text-white transition-all shadow-md">
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>

                {/* Modal Body (Scrollable) */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  
                  {/* Header Action Section: E-mail disparos */}
                  <div className="bg-slate-950/40 border border-slate-800/60 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ações e Notificações</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">Dispare comprovantes de nota fiscal e códigos de rastreamento.</p>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => {
                          const printWindow = window.open('', '_blank');
                          if (printWindow) {
                            printWindow.document.write(`
                              <!DOCTYPE html>
                              <html lang="pt-BR">
                                <head>
                                  <meta charset="UTF-8" />
                                  <title>Comprovante de Compra #${selectedOrder.numero_pedido}</title>
                                  <style>
                                    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; color: #1e293b; background: #fff; max-width: 750px; margin: 0 auto; }
                                    .header { border-bottom: 2px solid #0f172a; padding-bottom: 20px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: flex-start; }
                                    .company-name { font-size: 20px; font-weight: bold; color: #0f172a; margin-bottom: 4px; }
                                    .company-info { font-size: 12px; color: #64748b; line-height: 1.4; }
                                    .doc-title { text-align: right; }
                                    .doc-title h2 { margin: 0; font-size: 16px; color: #0f172a; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
                                    .doc-title p { margin: 4px 0 0; font-size: 11px; color: #0284c7; font-weight: bold; }
                                    .section-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px; }
                                    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; }
                                    .box-title { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
                                    .row { display: flex; justify-content: space-between; font-size: 12px; margin: 4px 0; }
                                    .row-label { color: #64748b; font-weight: 500; }
                                    .row-val { font-weight: 600; color: #0f172a; }
                                    .table-items { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; }
                                    .table-items th { background: #0f172a; color: #fff; padding: 10px 12px; font-size: 11px; text-transform: uppercase; text-align: left; font-weight: 700; }
                                    .table-items td { padding: 12px; font-size: 13px; border-bottom: 1px solid #e2e8f0; color: #334155; }
                                    .total-container { text-align: right; margin-top: 15px; padding-top: 15px; border-top: 2px solid #0f172a; font-size: 16px; font-weight: bold; color: #0f172a; }
                                    .footer { text-align: center; margin-top: 40px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
                                  </style>
                                </head>
                                <body>
                                  <div class="header">
                                    <div>
                                      <div class="company-name">${empresaNome || 'Cultura 420'}</div>
                                      <div class="company-info">
                                        CNPJ: ${empresaCnpj || '40.428.379/0001-50'}<br />
                                        ${empresaEndereco || 'Av. Paulista, 1000 - Bela Vista'}<br />
                                        ${empresaCidade || 'São Paulo'} - ${empresaEstado || 'SP'} &bull; CEP: ${empresaCep || '01310-100'}
                                      </div>
                                    </div>
                                    <div class="doc-title">
                                      <h2>Comprovante de Compra</h2>
                                      <p>NÃO POSSUI VALOR FISCAL</p>
                                    </div>
                                  </div>

                                  <div class="section-grid">
                                    <div class="box">
                                      <div class="box-title">Dados do Cliente</div>
                                      <div class="row"><span class="row-label">Nome:</span> <span class="row-val">${selectedOrder.customers?.nome || '—'}</span></div>
                                      <div class="row"><span class="row-label">E-mail:</span> <span class="row-val">${selectedOrder.customers?.email || '—'}</span></div>
                                      <div class="row"><span class="row-label">Telefone:</span> <span class="row-val">${selectedOrder.customers?.telefone || '—'}</span></div>
                                    </div>

                                    <div class="box">
                                      <div class="box-title">Endereço de Entrega</div>
                                      ${selectedOrder.addresses ? `
                                        <div class="row"><span class="row-label">Logradouro:</span> <span class="row-val">${selectedOrder.addresses.logradouro || ''}, ${selectedOrder.addresses.numero || ''}</span></div>
                                        <div class="row"><span class="row-label">Compl / Bairro:</span> <span class="row-val">${selectedOrder.addresses.complemento || ''} ${selectedOrder.addresses.bairro || ''}</span></div>
                                        <div class="row"><span class="row-label">Cidade / UF:</span> <span class="row-val">${selectedOrder.addresses.cidade || ''}/${selectedOrder.addresses.estado || ''}</span></div>
                                        <div class="row"><span class="row-label">CEP:</span> <span class="row-val">${selectedOrder.addresses.cep || ''}</span></div>
                                      ` : '<div>Sem endereço de entrega.</div>'}
                                    </div>
                                  </div>

                                  <table class="table-items">
                                    <thead>
                                      <tr>
                                        <th style="width: 55%;">Produto</th>
                                        <th style="width: 15%; text-align: center;">Qtd</th>
                                        <th style="width: 15%; text-align: right;">Unitário</th>
                                        <th style="width: 15%; text-align: right;">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      ${selectedOrder.itens?.map((item: any) => `
                                        <tr>
                                          <td>
                                            <div style="font-weight: 600;">${item.title}</div>
                                            ${item.sku ? `<div style="font-size: 10px; color: #64748b;">SKU: ${item.sku}</div>` : ''}
                                          </td>
                                          <td style="text-align: center;">${item.quantity}</td>
                                          <td style="text-align: right;">R$ ${parseFloat(item.price).toFixed(2)}</td>
                                          <td style="text-align: right; font-weight: 600;">R$ ${(item.quantity * parseFloat(item.price)).toFixed(2)}</td>
                                        </tr>
                                      `).join('')}
                                    </tbody>
                                  </table>

                                  <div class="total-container">
                                    TOTAL DO PEDIDO: R$ ${selectedOrder.valor_total?.toFixed(2) || '0.00'}
                                  </div>

                                  <div class="footer">
                                    <p>Código de Rastreamento: <strong>${selectedOrder.trackings?.codigo_rastreio || 'Pendente'}</strong></p>
                                    <p>Este comprovante é gerado de forma automática por Rastreio.IO &bull; Obrigado pela preferência!</p>
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

                      {selectedOrder.trackings?.codigo_rastreio && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={() => handleSendNotification('nota')}
                            disabled={sendingEmail || emailSent}
                            className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl transition-all text-xs font-semibold shadow-md ${
                              emailSent
                                ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400 cursor-default'
                                : 'bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border-slate-700/80 text-slate-200 disabled:opacity-55'
                            }`}>
                            {sendingEmail ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...</>
                            ) : emailSent ? (
                              <><CheckCircle2 className="w-3.5 h-3.5" /> Enviado!</>
                            ) : (
                              <><Mail className="w-3.5 h-3.5 text-blue-400" /> Enviar Nota</>
                            )}
                          </button>

                          <button onClick={() => handleSendNotification('rastreio')}
                            disabled={sendingEmail || emailSent}
                            className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl transition-all text-xs font-semibold shadow-md ${
                              emailSent
                                ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400 cursor-default'
                                : 'bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border-slate-700/80 text-slate-200 disabled:opacity-55'
                            }`}>
                            {sendingEmail ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...</>
                            ) : emailSent ? (
                              <><CheckCircle2 className="w-3.5 h-3.5" /> Enviado!</>
                            ) : (
                              <><Send className="w-3.5 h-3.5 text-indigo-400" /> Enviar Rastreio</>
                            )}
                          </button>

                          <button onClick={() => handleSendNotification('ambos')}
                            disabled={sendingEmail || emailSent}
                            className={`flex items-center gap-2 px-4 py-2 border rounded-xl transition-all text-xs font-semibold shadow-md ${
                              emailSent
                                ? 'bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 cursor-default'
                                : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 border-indigo-700/30 text-white disabled:opacity-55'
                            }`}>
                            {sendingEmail ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...</>
                            ) : emailSent ? (
                              <><CheckCheck className="w-3.5 h-3.5" /> E-mails + Shopify OK!</>
                            ) : (
                              <><Zap className="w-3.5 h-3.5" /> Enviar Rastreio + Nota</>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {emailError && (
                    <div className="w-full p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 font-semibold flex items-center gap-2">
                      <XCircle className="w-4 h-4 shrink-0" />
                      <span>{emailError}</span>
                    </div>
                  )}

                  {/* Informações Básicas do Cliente e Endereço */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Cliente */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 shadow-sm">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                        <User className="w-3.5 h-3.5 text-indigo-400" /> Dados do Cliente
                      </h3>
                      <div className="grid grid-cols-2 gap-4">
                        <InfoRow label="Nome" value={selectedOrder.customers?.nome} />
                        <InfoRow label="E-mail" value={selectedOrder.customers?.email} mono />
                        {selectedOrder.customers?.telefone && <InfoRow label="Telefone" value={selectedOrder.customers.telefone} />}
                        {selectedOrder.customers?.cpf && <InfoRow label="CPF" value={selectedOrder.customers.cpf} mono />}
                      </div>
                    </div>

                    {/* Endereço */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 shadow-sm">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                        <MapPin className="w-3.5 h-3.5 text-indigo-400" /> Endereço de Entrega
                      </h3>
                      {selectedOrder.addresses ? (
                        <div className="text-xs text-slate-300 space-y-1">
                          <p className="font-semibold">{selectedOrder.addresses.logradouro}{selectedOrder.addresses.numero ? `, ${selectedOrder.addresses.numero}` : ''}</p>
                          {selectedOrder.addresses.complemento && <p className="text-slate-400">{selectedOrder.addresses.complemento}</p>}
                          {selectedOrder.addresses.bairro && <p className="text-slate-400">{selectedOrder.addresses.bairro}</p>}
                          <p>{selectedOrder.addresses.cidade} / {selectedOrder.addresses.estado}</p>
                          <p className="font-mono text-slate-400">CEP: {selectedOrder.addresses.cep}</p>
                        </div>
                      ) : <p className="text-xs text-slate-500">Sem endereço cadastrado.</p>}
                    </div>
                  </div>

                  {/* Itens do Pedido */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 shadow-sm">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                      <FileText className="w-3.5 h-3.5 text-indigo-400" /> Itens do Pedido
                    </h3>
                    <div className="divide-y divide-slate-800/80">
                      {selectedOrder.itens?.map((item, idx) => (
                        <div key={idx} className="py-3 flex items-center justify-between text-xs">
                          <div>
                            <p className="font-semibold text-white">{item.title}</p>
                            <p className="text-[10px] text-slate-500 mt-1">Qtd: {item.quantity} × R$ {item.price} · SKU: {item.sku || 'N/A'}</p>
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

                  {/* Rastreio Eventos e Histórico */}
                  {selectedOrder.trackings ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {/* Registrar Evento */}
                      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 shadow-sm">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                          <PlusCircle className="w-3.5 h-3.5 text-indigo-400" /> Registrar Novo Evento
                        </h3>
                        {updateError && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2.5 rounded-lg">{updateError}</div>}
                        <form onSubmit={handleAddStatus} className="space-y-3.5">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status</label>
                              <select value={updateStatus} onChange={e => setUpdateStatus(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white font-semibold">
                                <option value="postado">Postado</option>
                                <option value="em_transito">Em Trânsito</option>
                                <option value="saiu_para_entrega">Saiu para Entrega</option>
                                <option value="entregue">Entregue</option>
                                <option value="extraviado">Extraviado</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Localidade</label>
                              <input type="text" required value={updateLocal} onChange={e => setUpdateLocal(e.target.value)}
                                placeholder="Ex: São Paulo, SP"
                                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Descrição</label>
                            <input type="text" required value={updateDesc} onChange={e => setUpdateDesc(e.target.value)}
                              placeholder="Ex: Objeto encaminhado para Unidade de Tratamento"
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Data e Hora (Opcional)</label>
                            <input type="datetime-local" value={updateDate} onChange={e => setUpdateDate(e.target.value)}
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white font-mono" />
                            <span className="text-[9px] text-slate-500 mt-0.5 block">Deixe vazio para usar a data/hora atual.</span>
                          </div>
                          <button type="submit" disabled={submittingUpdate}
                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors text-white shadow-md cursor-pointer flex items-center justify-center gap-1.5">
                            {submittingUpdate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                            Salvar Evento
                          </button>
                        </form>
                      </div>

                      {/* Histórico */}
                      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3 shadow-sm">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                          <Clock className="w-3.5 h-3.5 text-indigo-400" /> Histórico de Movimentações
                        </h3>
                        <div className="relative border-l border-slate-800 ml-2.5 pl-4 space-y-4 max-h-[300px] overflow-y-auto pr-1">
                          {selectedOrder.trackings.historico?.map((ev: any, realIdx: number) => ({ ev, realIdx })).reverse().map(({ ev, realIdx }) => (
                            <div key={realIdx} className="relative text-xs group">
                              <div className="absolute -left-[21px] top-0.5 w-3.5 h-3.5 rounded-full bg-slate-800 border border-slate-900 flex items-center justify-center">
                                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                              </div>

                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-0.5 flex-1 min-w-0">
                                  <p className="font-semibold text-slate-200 leading-snug">{ev.descricao}</p>
                                  <p className="text-[10px] text-slate-500 flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-slate-400">{new Date(ev.data).toLocaleString('pt-BR')}</span>
                                    <span>·</span>
                                    <span className="text-slate-300 font-medium">{ev.local}</span>
                                    <span className="px-1.5 py-0.2 rounded bg-slate-800 text-[9px] font-mono text-indigo-300 uppercase">{ev.status}</span>
                                  </p>
                                </div>

                                {/* Botões de Ação Individual (Editar / Excluir) */}
                                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity shrink-0">
                                  <button
                                    title="Editar Evento"
                                    onClick={() => {
                                      setEditingEventIndex(realIdx);
                                      setEditStatus(ev.status || 'em_transito');
                                      setEditDesc(ev.descricao || '');
                                      setEditLocal(ev.local || '');
                                      // Formata a data para datetime-local input
                                      const d = new Date(ev.data);
                                      const tzOffset = d.getTimezoneOffset() * 60000;
                                      const localISOTime = (new Date(d.getTime() - tzOffset)).toISOString().slice(0, 16);
                                      setEditDate(localISOTime);
                                    }}
                                    className="p-1 hover:bg-indigo-500/20 text-slate-400 hover:text-indigo-400 rounded transition-colors cursor-pointer"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                  
                                  <button
                                    title="Excluir Evento"
                                    onClick={() => handleDeleteEvent(realIdx)}
                                    disabled={deletingIndex === realIdx}
                                    className="p-1 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded transition-colors cursor-pointer disabled:opacity-50"
                                  >
                                    {deletingIndex === realIdx ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Formulário de Vínculo de Rastreio se não houver rastreamento vinculado */
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-sm max-w-lg">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-200 flex items-center gap-1.5">
                          <Link className="w-4 h-4 text-indigo-400" /> Vincular Código de Rastreamento
                        </h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">Este pedido importado do Shopify não tem um rastreamento cadastrado. Cadastre para que a página de rastreio funcione.</p>
                      </div>

                      {linkingError && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2 rounded-lg">
                          {linkingError}
                        </div>
                      )}

                      <form onSubmit={handleLinkTrackingCode} className="space-y-3.5 text-xs text-slate-300">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-300">
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Código de Rastreamento</label>
                            <input type="text" required value={linkTrackingCode} onChange={e => setLinkTrackingCode(e.target.value)}
                              placeholder="Ex: BR2608B4036C"
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white font-mono uppercase" />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status Inicial</label>
                            <select value={linkTrackingStatus} onChange={e => setLinkTrackingStatus(e.target.value)}
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white font-semibold">
                              <option value="pendente_taxa">Pendente de Taxa</option>
                              <option value="postado">Postado</option>
                              <option value="em_transito">Em Trânsito</option>
                              <option value="saiu_para_entrega">Saiu para Entrega</option>
                              <option value="entregue">Entregue</option>
                            </select>
                          </div>
                        </div>

                        <button type="submit" disabled={linkingLoading || !linkTrackingCode}
                          className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-bold rounded-lg transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer">
                          {linkingLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link className="w-3.5 h-3.5" />}
                          Vincular Código
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Modal de Edição de Evento Individual */}
                  {editingEventIndex !== null && (
                    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                          <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                            <Pencil className="w-4 h-4 text-indigo-400" /> Editar Evento do Histórico
                          </h3>
                          <button onClick={() => setEditingEventIndex(null)} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <form onSubmit={handleEditEventSubmit} className="space-y-3.5">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status</label>
                              <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white font-semibold">
                                <option value="postado">Postado</option>
                                <option value="em_transito">Em Trânsito</option>
                                <option value="saiu_para_entrega">Saiu para Entrega</option>
                                <option value="entregue">Entregue</option>
                                <option value="extraviado">Extraviado</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Localidade</label>
                              <input type="text" required value={editLocal} onChange={e => setEditLocal(e.target.value)}
                                placeholder="Ex: São Paulo, SP"
                                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white" />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Descrição</label>
                            <input type="text" required value={editDesc} onChange={e => setEditDesc(e.target.value)}
                              placeholder="Ex: Objeto encaminhado..."
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white" />
                          </div>

                          <div>
                            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Data e Hora do Evento</label>
                            <input type="datetime-local" required value={editDate} onChange={e => setEditDate(e.target.value)}
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white font-mono" />
                          </div>

                          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                            <button type="button" onClick={() => setEditingEventIndex(null)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-xl">
                              Cancelar
                            </button>
                            <button type="submit" disabled={submittingEdit} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-xl flex items-center gap-1.5 disabled:opacity-50">
                              {submittingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              Salvar Alterações
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}

                  {/* Modal de Detalhes da Conversa de Recuperação com a IA */}
                  {selectedAiConvModal && (
                    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400">
                              <Bot className="w-5 h-5" />
                            </div>
                            <div>
                              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                                Conversa de Recuperação · {selectedAiConvModal.customer_name || 'Cliente'}
                              </h3>
                              <p className="text-[11px] text-slate-400 font-mono">{selectedAiConvModal.customer_phone}</p>
                            </div>
                          </div>
                          <button onClick={() => setSelectedAiConvModal(null)} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-3 p-1">
                          {Array.isArray(selectedAiConvModal.mensagens) && selectedAiConvModal.mensagens.length > 0 ? (
                            selectedAiConvModal.mensagens.map((msg: any, mIdx: number) => (
                              <div key={mIdx} className={`flex ${msg.sender === 'customer' ? 'justify-start' : msg.sender === 'system' ? 'justify-center' : 'justify-end'}`}>
                                {msg.sender === 'system' ? (
                                  <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] px-3 py-1.5 rounded-full font-bold">
                                    {msg.text}
                                  </div>
                                ) : (
                                  <div className={`max-w-[85%] p-3.5 rounded-2xl text-xs ${
                                    msg.sender === 'customer'
                                      ? 'bg-slate-950 border border-slate-800 text-slate-200'
                                      : 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md'
                                  }`}>
                                    <span className="text-[9px] font-bold block uppercase tracking-wider mb-1 opacity-75">
                                      {msg.sender === 'customer' ? '👤 Cliente' : '🤖 Agente de IA'}
                                    </span>
                                    <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                                    {msg.timestamp && (
                                      <span className="text-[9px] block text-right mt-1 opacity-60 font-mono">
                                        {new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))
                          ) : (
                            <div className="py-8 text-center text-slate-500 text-xs">
                              Aguardando envio ou resposta do cliente via WhatsApp.
                            </div>
                          )}
                        </div>

                        <div className="border-t border-slate-800 pt-3 flex items-center justify-between text-xs">
                          <span className="text-slate-400">Status: <strong className="text-white capitalize">{selectedAiConvModal.status}</strong></span>
                          <button onClick={() => setSelectedAiConvModal(null)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold">
                            Fechar
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              </>
            )}

          </div>
        </div>
      )}

      {/* Modal Cadastro Manual */}
      {showManualOrderModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-indigo-400" /> Criar Encomenda de Teste (Manual)
              </h3>
              <button onClick={() => setShowManualOrderModal(false)} className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            {manualError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2.5 rounded-lg">
                {manualError}
              </div>
            )}

            <form onSubmit={handleCreateManualOrder} className="space-y-3.5 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-3 text-slate-300">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Número do Pedido</label>
                  <input type="text" required value={manualOrderNum} onChange={e => setManualOrderNum(e.target.value)}
                    placeholder="Ex: 1001-Manual"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Nome do Cliente</label>
                  <input type="text" required value={manualClientName} onChange={e => setManualClientName(e.target.value)}
                    placeholder="Nome Completo"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-slate-300">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">E-mail do Cliente</label>
                  <input type="email" required value={manualClientEmail} onChange={e => setManualClientEmail(e.target.value)}
                    placeholder="cliente@email.com"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Código de Rastreamento</label>
                  <input type="text" required value={manualTrackingCode} onChange={e => setManualTrackingCode(e.target.value)}
                    placeholder="Ex: BR2608B4036C"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white font-mono uppercase" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Status Inicial do Rastreio</label>
                <select value={manualTrackingStatus} onChange={e => setManualTrackingStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 text-white font-semibold">
                  <option value="pendente_taxa">Pendente de Taxa (Retentativas de entrega falhas)</option>
                  <option value="em_transito">Em Trânsito</option>
                  <option value="saiu_para_entrega">Saiu para Entrega</option>
                  <option value="entregue">Entregue</option>
                </select>
                <span className="text-[9px] text-slate-500 mt-1 block">O status &quot;Pendente de Taxa&quot; gera automaticamente o histórico de retentativas dos Correios para ativar o checkout.</span>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button type="button" onClick={() => setShowManualOrderModal(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 rounded-xl cursor-pointer">
                  Cancelar
                </button>
                <button type="submit" disabled={manualLoading} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white rounded-xl flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                  {manualLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Criar Pedido
                </button>
              </div>
            </form>
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
  label, value, onChange, placeholder, type = 'text', hint, mono, required = false,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; hint?: string; mono?: boolean; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">{label}</label>
      <input type={type} required={required} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm ${mono ? 'font-mono' : ''}`} />
      {hint && <span className="text-[10px] text-slate-500 mt-1 block">{hint}</span>}
    </div>
  );
}
