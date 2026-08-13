import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkAdminAuth } from '@/lib/authHelper';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const storeId = searchParams.get('store_id');

    if (!storeId) {
      return NextResponse.json({ error: 'ID da loja não informado.' }, { status: 400 });
    }

    const { data: storeUsers, error } = await supabaseAdmin
      .from('store_users')
      .select('*')
      .eq('store_id', storeId);

    if (error) {
      return NextResponse.json({ users: [] });
    }

    return NextResponse.json({ users: storeUsers || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro ao buscar membros.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const body = await req.json();
    const { store_id, email, role = 'owner' } = body;

    if (!store_id || !email) {
      return NextResponse.json({ error: 'ID da loja e E-mail são obrigatórios.' }, { status: 422 });
    }

    // Buscar ID do usuário no Supabase Auth por email
    const { data: usersData, error: userErr } = await supabaseAdmin.auth.admin.listUsers();
    if (userErr) throw userErr;

    const user = usersData.users.find(u => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
      return NextResponse.json({
        error: 'Usuário não encontrado. Peça para o lojista se cadastrar/criar conta primeiro.',
      }, { status: 404 });
    }

    const { data: newBind, error: bindErr } = await supabaseAdmin
      .from('store_users')
      .upsert({
        user_id: user.id,
        store_id,
        role,
      }, { onConflict: 'user_id,store_id' })
      .select()
      .single();

    if (bindErr) throw bindErr;

    return NextResponse.json({
      success: true,
      message: `Usuário ${email} vinculado à loja com sucesso!`,
      member: newBind,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro ao vincular lojista.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const isAdmin = await checkAdminAuth(req);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const bindId = searchParams.get('id');

    if (!bindId) {
      return NextResponse.json({ error: 'ID da associação não informado.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('store_users').delete().eq('id', bindId);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Vínculo removido com sucesso.' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Erro ao remover vínculo.' }, { status: 500 });
  }
}
