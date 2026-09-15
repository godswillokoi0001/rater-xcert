import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { Button, Input, Label, Spinner } from '@/components/ui';
import { GraduationCap, ShieldCheck, Mail, Lock, User, ArrowLeft, AlertCircle } from 'lucide-react';

type Mode = 'candidate-login' | 'candidate-signup' | 'admin-login' | 'bootstrap';

export function AuthPage({ mode }: { mode: Mode }) {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'candidate-signup') {
        await signUp(email, password, name);
      } else {
        await signIn(email, password);
      }
      // The router will redirect based on auth state and role.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<Mode, { title: string; subtitle: string }> = {
    'candidate-login': { title: 'Candidate Sign In', subtitle: 'Access your certification exams' },
    'candidate-signup': { title: 'Create Account', subtitle: 'Register to take certification exams' },
    'admin-login': { title: 'Admin Sign In', subtitle: 'Manage tests, questions, and results' },
    'bootstrap': { title: 'Create Super Admin', subtitle: 'Set up the first administrator account' },
  };

  const { title, subtitle } = titles[mode];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      <div className="w-full max-w-md">
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors"
        >
          <ArrowLeft size={16} /> Back to home
        </button>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 animate-fade-in">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-blue-700 flex items-center justify-center text-white mb-3 shadow-lg shadow-blue-700/20">
              {mode === 'admin-login' || mode === 'bootstrap' ? <ShieldCheck size={28} /> : <GraduationCap size={28} />}
            </div>
            <h1 className="text-2xl font-bold text-slate-900 font-serif">{title}</h1>
            <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 animate-fade-in">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'candidate-signup' && (
              <div>
                <Label>Full Name</Label>
                <div className="relative">
                  <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    className="pl-10"
                  />
                </div>
              </div>
            )}
            <div>
              <Label>Email Address</Label>
              <div className="relative">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="pl-10"
                />
              </div>
            </div>
            <div>
              <Label>Password</Label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-10"
                  minLength={6}
                />
              </div>
            </div>

            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {loading ? <Spinner /> : mode === 'candidate-signup' ? 'Create Account' : 'Sign In'}
            </Button>
          </form>

          {mode === 'admin-login' && (
            <p className="text-center text-sm text-slate-500 mt-6">
              First time setup?{' '}
              <button onClick={() => navigate('/bootstrap')} className="text-blue-600 font-medium hover:text-blue-700">
                Create super admin
              </button>
            </p>
          )}
          {mode === 'candidate-login' && (
            <p className="text-center text-sm text-slate-500 mt-6">
              Don't have an account?{' '}
              <button onClick={() => navigate('/signup')} className="text-blue-600 font-medium hover:text-blue-700">
                Sign up
              </button>
            </p>
          )}
          {mode === 'candidate-signup' && (
            <p className="text-center text-sm text-slate-500 mt-6">
              Already have an account?{' '}
              <button onClick={() => navigate('/login')} className="text-blue-600 font-medium hover:text-blue-700">
                Sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function BootstrapPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { callAdminApi } = await import('@/lib/supabase');
      // For bootstrap, we don't need auth — the edge function checks if super_admin exists
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/admin-api/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 max-w-md w-full text-center animate-scale-in">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-green-600 mx-auto mb-4">
            <ShieldCheck size={32} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Super Admin Created</h2>
          <p className="text-sm text-slate-600 mb-6">Your super admin account is ready. You can now sign in to manage the platform.</p>
          <Button onClick={() => navigate('/admin')} className="w-full">Go to Admin Sign In</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      <div className="w-full max-w-md">
        <button onClick={() => navigate('/')} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors">
          <ArrowLeft size={16} /> Back to home
        </button>
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 animate-fade-in">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-blue-700 flex items-center justify-center text-white mb-3 shadow-lg shadow-blue-700/20">
              <ShieldCheck size={28} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 font-serif">Create Super Admin</h1>
            <p className="text-sm text-slate-500 mt-1">Set up the first administrator account</p>
          </div>
          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <form onSubmit={handleBootstrap} className="space-y-4">
            <div>
              <Label>Full Name</Label>
              <Input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Super Admin" />
            </div>
            <div>
              <Label>Email Address</Label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" />
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" minLength={6} />
            </div>
            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {loading ? <Spinner /> : 'Create Super Admin'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
