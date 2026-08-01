import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * Verifica se a requisição possui um token JWT válido de usuário autenticado no Supabase.
 */
export async function checkAdminAuth(req: NextRequest): Promise<boolean> {
  // Permite bypass em ambiente de desenvolvimento local usando credenciais mockadas
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (supabaseUrl.includes('mock-project') || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY === 'mock-service-role-key') {
    return true;
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  
  const token = authHeader.split(' ')[1];
  
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  
  if (error || !user) {
    return false;
  }
  
  return true;
}
