'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Next.js Admin Error Boundary caught an error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center text-white" style={{ backgroundColor: '#020617', minHeight: '100vh' }}>
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full space-y-4 shadow-2xl">
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-white">Painel Temporariamente Indisponível</h2>
        <p className="text-xs text-slate-400">
          {error?.message || 'Ocorreu um erro ao carregar os componentes do painel.'}
        </p>
        <button
          onClick={() => reset()}
          className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 rounded-xl text-xs font-bold text-white transition-all cursor-pointer shadow-lg shadow-indigo-950/50 flex items-center justify-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Tentar Novamente
        </button>
      </div>
    </div>
  );
}
