import { createClient } from '@supabase/supabase-js';

const sanitizeHeaderString = (str: string = '') => str.replace(/[^\x00-\x7F]/g, '').trim();

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mock-project.supabase.co';
const rawAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key';

const supabaseUrl = sanitizeHeaderString(rawUrl);
const supabaseAnonKey = sanitizeHeaderString(rawAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);


