import { createClient } from '@supabase/supabase-js';

const sanitizeHeaderString = (str: string = '') => str.replace(/[^\x00-\x7F]/g, '').trim();

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock-project.supabase.co';
const rawServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'mock-service-role-key';

const supabaseUrl = sanitizeHeaderString(rawUrl);
const supabaseServiceKey = sanitizeHeaderString(rawServiceKey);

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY não configurada. Usando mock credentials para compilação.');
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});


