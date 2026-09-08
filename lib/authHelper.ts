import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export interface AuthUser {
  id: string;
  email: string;
}

export interface UserStoresContext {
  allowedStoreIds: string[];
  rolesByStore: Record<string, string>;
  isSuperAdmin: boolean;
  hasStores: boolean;
}

export interface TenantValidationResult {
  authorized: boolean;
  status: number;
  error?: string;
  user?: AuthUser;
  allowedStoreIds: string[];
  targetStoreId?: string | null;
  role?: string;
  isSuperAdmin: boolean;
}

/**
 * 1. Extrai e valida o usuário autenticado a partir do token JWT no header Authorization
 */
export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const isMock = supabaseUrl.includes('mock-project') ||
                 !process.env.SUPABASE_SERVICE_ROLE_KEY ||
                 process.env.SUPABASE_SERVICE_ROLE_KEY === 'mock-service-role-key';

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (isMock) {
      return { id: 'mock-admin-id', email: 'admin@rastreio.io' };
    }
    return null;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    if (isMock) {
      return { id: 'mock-admin-id', email: 'admin@rastreio.io' };
    }
    return null;
  }

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      if (isMock) {
        return { id: 'mock-admin-id', email: 'admin@rastreio.io' };
      }
      return null;
    }
    return {
      id: user.id,
      email: user.email || '',
    };
  } catch (err) {
    if (isMock) {
      return { id: 'mock-admin-id', email: 'admin@rastreio.io' };
    }
    return null;
  }
}

/**
 * 2. Consulta lojas e roles associadas ao usuário no banco (store_users)
 */
export async function getUserStores(userId: string, userEmail?: string): Promise<UserStoresContext> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const isMock = supabaseUrl.includes('mock-project') ||
                 !process.env.SUPABASE_SERVICE_ROLE_KEY ||
                 process.env.SUPABASE_SERVICE_ROLE_KEY === 'mock-service-role-key';

  if (isMock) {
    return {
      allowedStoreIds: ['mock-store', 'default-store'],
      rolesByStore: { 'mock-store': 'owner', 'default-store': 'owner' },
      isSuperAdmin: true,
      hasStores: true,
    };
  }

  try {
    let query = supabaseAdmin
      .from('store_users')
      .select('store_id, role, user_id, user_email');

    // Busca tanto por user_id quanto por user_email
    if (userId && userEmail) {
      query = query.or(`user_id.eq.${userId},user_email.eq.${userEmail}`);
    } else if (userId) {
      query = query.eq('user_id', userId);
    } else if (userEmail) {
      query = query.eq('user_email', userEmail);
    } else {
      return {
        allowedStoreIds: [],
        rolesByStore: {},
        isSuperAdmin: false,
        hasStores: false,
      };
    }

    const { data: binds, error } = await query;
    if (error || !binds || binds.length === 0) {
      return {
        allowedStoreIds: [],
        rolesByStore: {},
        isSuperAdmin: false,
        hasStores: false,
      };
    }

    const rolesByStore: Record<string, string> = {};
    const allowedStoreIds: string[] = [];
    let isSuperAdmin = false;

    for (const b of binds) {
      const role = (b.role || 'member').toLowerCase();
      if (role === 'superadmin' || role === 'admin_global') {
        isSuperAdmin = true;
      }
      if (b.store_id) {
        allowedStoreIds.push(b.store_id);
        rolesByStore[b.store_id] = role;
      }
    }

    const uniqueStoreIds = Array.from(new Set(allowedStoreIds));

    return {
      allowedStoreIds: uniqueStoreIds,
      rolesByStore,
      isSuperAdmin,
      hasStores: uniqueStoreIds.length > 0 || isSuperAdmin,
    };
  } catch (err) {
    console.error('Erro ao buscar lojas do usuário em getUserStores:', err);
    return {
      allowedStoreIds: [],
      rolesByStore: {},
      isSuperAdmin: false,
      hasStores: false,
    };
  }
}

/**
 * 3. Valida permissão do usuário para um store_id solicitado
 * Regras:
 * - Autentica usuário;
 * - Busca lojas permitidas;
 * - Diferencia usuário sem loja, owner/member e superadmin;
 * - Se targetStoreId for 'all' ou nulo:
 *   - Se superadmin: acesso livre.
 *   - Se lojista: restringe consulta aos allowedStoreIds dele.
 * - Se targetStoreId específico:
 *   - Se superadmin ou se targetStoreId constar em allowedStoreIds: autorizado.
 *   - Senão: 403 Forbidden.
 */
export async function validateTenantAccess(
  req: NextRequest,
  targetStoreId?: string | null
): Promise<TenantValidationResult> {
  const user = await getAuthUser(req);
  if (!user) {
    return {
      authorized: false,
      status: 401,
      error: 'Não autorizado. Token de autenticação ausente ou inválido.',
      allowedStoreIds: [],
      isSuperAdmin: false,
    };
  }

  const userStores = await getUserStores(user.id, user.email);

  // Superadmin global tem acesso irrestrito
  if (userStores.isSuperAdmin) {
    return {
      authorized: true,
      status: 200,
      user,
      allowedStoreIds: userStores.allowedStoreIds,
      targetStoreId: targetStoreId && targetStoreId !== 'all' ? targetStoreId : null,
      role: 'superadmin',
      isSuperAdmin: true,
    };
  }

  // Usuário comum sem nenhuma loja vinculada
  if (!userStores.hasStores) {
    return {
      authorized: false,
      status: 403,
      error: 'Acesso negado. Usuário não possui lojas vinculadas.',
      user,
      allowedStoreIds: [],
      isSuperAdmin: false,
    };
  }

  // Se não solicitou uma loja específica ou solicitou 'all'
  if (!targetStoreId || targetStoreId === 'all') {
    return {
      authorized: true,
      status: 200,
      user,
      allowedStoreIds: userStores.allowedStoreIds,
      targetStoreId: null, // Indica que deve filtrar por in('store_id', allowedStoreIds)
      isSuperAdmin: false,
    };
  }

  // Se solicitou uma loja específica
  if (userStores.allowedStoreIds.includes(targetStoreId)) {
    return {
      authorized: true,
      status: 200,
      user,
      allowedStoreIds: userStores.allowedStoreIds,
      targetStoreId,
      role: userStores.rolesByStore[targetStoreId] || 'member',
      isSuperAdmin: false,
    };
  }

  // Tentativa de acesso a loja que não pertence ao usuário
  return {
    authorized: false,
    status: 403,
    error: 'Acesso negado. Você não tem permissão para acessar esta loja.',
    user,
    allowedStoreIds: userStores.allowedStoreIds,
    targetStoreId,
    isSuperAdmin: false,
  };
}

/**
 * Mantém compatibilidade com chamadas legadas
 */
export async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  const user = await getAuthUser(req);
  return !!user;
}

