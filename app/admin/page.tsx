'use client';

import dynamic from 'next/dynamic';

const AdminClient = dynamic(() => import('./AdminClient'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white" style={{ backgroundColor: '#020617', minHeight: '100vh' }}>
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-400 font-sans font-medium">Carregando Painel Administrativo...</p>
      </div>
    </div>
  ),
});

export default function AdminPage() {
  return <AdminClient />;
}
