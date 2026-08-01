'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Search, ArrowRight, ShieldCheck } from 'lucide-react';

export default function Home() {
  const [codigo, setCodigo] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigo.trim()) return;
    setLoading(true);
    router.push(`/rastreio/${codigo.toUpperCase().trim()}`);
  };

  return (
    <div className="flex flex-col flex-1 items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-zinc-950 text-white font-sans overflow-hidden relative px-4">
      {/* Background blobs for premium look */}
      <div className="absolute top-0 -left-4 w-96 h-96 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
      <div className="absolute top-0 -right-4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
      <div className="absolute -bottom-8 left-20 w-96 h-96 bg-emerald-500 rounded-full mix-blend-multiply filter blur-3xl opacity-15 animate-blob animation-delay-4000"></div>

      <div className="w-full max-w-xl z-10">
        <header className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/50 backdrop-blur-md mb-6 animate-fade-in">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-semibold text-slate-300 tracking-wide">Rastreamento Oficial Integrado</span>
          </div>
          
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-purple-400 bg-clip-text text-transparent mb-4">
            Rastreie sua Encomenda
          </h1>
          <p className="text-slate-400 text-base sm:text-lg max-w-md mx-auto">
            Insira o código de rastreamento enviado por e-mail para acompanhar a entrega do seu pedido em tempo real.
          </p>
        </header>

        <main className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="relative flex items-center">
              <div className="absolute left-4 text-slate-500">
                <Package className="w-5 h-5" />
              </div>
              <input
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="Ex: BR2607A3F9K1"
                required
                className="w-full pl-12 pr-12 py-4 bg-slate-950/80 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono tracking-wider text-lg"
              />
              <button
                type="submit"
                disabled={loading}
                className="absolute right-3 p-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 rounded-lg transition-colors text-white disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <ArrowRight className="w-5 h-5" />
                )}
              </button>
            </div>
            
            <div className="flex justify-between items-center text-xs text-slate-500 px-1 pt-2">
              <span className="flex items-center gap-1">
                Formato padrão: <span className="font-mono text-slate-400">BRYYMMXXXXXX</span>
              </span>
              <a href="/admin" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                Painel Admin
              </a>
            </div>
          </form>
        </main>

        <footer className="text-center mt-12 text-xs text-slate-600">
          <p>© {new Date().getFullYear()} Rastreamento Próprio. Todos os direitos reservados.</p>
        </footer>
      </div>
    </div>
  );
}
