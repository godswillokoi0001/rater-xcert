import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { navigate } from '@/lib/router';
import { ThemeToggle } from '@/lib/theme';
import { Button, Input, Label, Spinner } from '@/components/ui';
import { ShieldCheck, Mail, Lock, ArrowLeft, AlertCircle, Key } from 'lucide-react';

export { CandidateAuthPage } from '@/pages/candidate/Auth';
export { WorkerAuthPage } from '@/pages/worker/Auth';

export function AdminAuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data: authData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInErr) throw signInErr;
      if (!authData.user) throw new Error('Sign in failed');

      // Verify that this account is an administrator
      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('id, name, role, status')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (profErr) throw profErr;

      if (prof) {
        if (prof.role === 'candidate' || prof.role === 'worker') {
          await supabase.auth.signOut();
          throw new Error(
            'Access Denied: You do not have administrative privileges. Candidates and Workers must sign in using their respective portals.'
          );
        }
        if (prof.status === 'disabled') {
          await supabase.auth.signOut();
          throw new Error('Your administrator account has been disabled. Please contact the system owner.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 text-slate-100 transition-colors">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} /> Back to home
          </button>
          <ThemeToggle />
        </div>

        <div className="bg-slate-900/90 rounded-2xl shadow-2xl border border-slate-800 p-8 animate-fade-in backdrop-blur-md">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-3 shadow-lg shadow-amber-500/10">
              <ShieldCheck size={28} />
            </div>
            <div className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 mb-2">
              <Key size={12} /> Restricted Access
            </div>
            <h1 className="text-2xl font-bold text-white font-serif">Admin Portal</h1>
            <p className="text-sm text-slate-400 mt-1 text-center">
              Restricted management console for authorized staff and super administrators
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 mb-5 rounded-xl bg-red-950/60 border border-red-800 text-sm text-red-300 animate-fade-in">
              <AlertCircle size={18} className="shrink-0 mt-0.5 text-red-400" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="text-slate-300">Admin Email</Label>
              <div className="relative">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@institution.edu"
                  className="pl-10 bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:border-amber-500 focus:ring-amber-500"
                />
              </div>
            </div>

            <div>
              <Label className="text-slate-300">Password</Label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-10 bg-slate-800/80 border-slate-700 text-white placeholder-slate-500 focus:border-amber-500 focus:ring-amber-500"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-600 hover:bg-amber-500 text-white font-semibold shadow-md shadow-amber-600/20"
              size="lg"
            >
              {loading ? <Spinner /> : 'Authenticate Admin'}
            </Button>
          </form>

          <div className="mt-8 pt-4 border-t border-slate-800/80 text-center">
            <p className="text-xs text-slate-400">
              Candidate or Worker?{' '}
              <button
                onClick={() => navigate('/login')}
                className="text-blue-400 hover:underline font-semibold"
              >
                Candidate Sign In
              </button>
              {' • '}
              <button
                onClick={() => navigate('/worker/login')}
                className="text-purple-400 hover:underline font-semibold"
              >
                Worker Sign In
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
