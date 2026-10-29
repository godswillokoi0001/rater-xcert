import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { ThemeToggle } from '@/lib/theme';
import { Button, Input, Label, Spinner } from '@/components/ui';
import { GraduationCap, ShieldCheck, Mail, Lock, User, ArrowLeft, AlertCircle, Briefcase, Sparkles, Key } from 'lucide-react';

export function CandidateAuthPage({
  mode = 'login',
  forcedRole,
}: {
  mode?: 'login' | 'signup';
  forcedRole?: 'candidate' | 'worker';
}) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const detectedRole =
    forcedRole ||
    (typeof window !== 'undefined' &&
    (window.location.hash.includes('role=worker') || window.location.hash.startsWith('#/worker'))
      ? 'worker'
      : 'candidate');

  const [signupRole, setSignupRole] = useState<'candidate' | 'worker'>(detectedRole);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isWorker = forcedRole === 'worker' || (!forcedRole && signupRole === 'worker');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        const targetRole = forcedRole || signupRole;
        await signUp(email.trim(), password, name.trim(), targetRole);
      } else {
        const { data: authData, error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInErr) throw signInErr;
        if (!authData.user) throw new Error('Sign in failed');

        // Verify that this account is a candidate or worker, NOT an admin
        const { data: prof, error: profErr } = await supabase
          .from('profiles')
          .select('id, name, role, status')
          .eq('id', authData.user.id)
          .maybeSingle();

        if (profErr) throw profErr;

        if (prof) {
          if (prof.role === 'admin' || prof.role === 'super_admin') {
            await supabase.auth.signOut();
            throw new Error(
              'This portal is exclusively for Candidates and Workers. Administrative accounts must use the Admin Portal link located in the website footer.'
            );
          }
          if (prof.status === 'disabled') {
            await supabase.auth.signOut();
            throw new Error('Your account has been disabled. Please contact system support.');
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div
      className={`min-h-screen flex items-center justify-center p-4 transition-colors ${
        isWorker
          ? 'bg-gradient-to-br from-slate-50 via-purple-50/40 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-purple-950/20'
          : 'bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/20'
      }`}
    >
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            <ArrowLeft size={16} /> Back to home
          </button>
          <ThemeToggle />
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-8 animate-fade-in transition-colors">
          <div className="flex flex-col items-center mb-8">
            <div
              className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white mb-3 shadow-lg ${
                isWorker ? 'bg-purple-700 shadow-purple-700/20' : 'bg-blue-700 shadow-blue-700/20'
              }`}
            >
              {isWorker ? <Briefcase size={28} /> : <GraduationCap size={28} />}
            </div>
            <div
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full border mb-2 ${
                isWorker
                  ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                  : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
              }`}
            >
              <Sparkles size={12} />
              {isWorker ? 'Worker Operations Portal' : 'Candidate Assessment Portal'}
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-serif">
              {isSignup
                ? isWorker
                  ? 'Create Worker Account'
                  : 'Create Candidate Account'
                : isWorker
                ? 'Worker Portal Sign In'
                : 'Welcome Back'}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 text-center">
              {isSignup
                ? isWorker
                  ? 'Register as a verified worker to access task evaluations and workforce tasks.'
                  : 'Register to access evaluations and certification tests.'
                : isWorker
                ? 'Sign in to access your worker operations hub and assigned tasks.'
                : 'Sign in to access your tests and certification credentials.'}
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 mb-5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300 animate-fade-in">
              <AlertCircle size={18} className="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <>
                {!forcedRole ? (
                  <div>
                    <Label>I am registering as a:</Label>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-1.5">
                      <button
                        type="button"
                        onClick={() => setSignupRole('candidate')}
                        className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                          signupRole === 'candidate'
                            ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        <GraduationCap size={16} /> Candidate
                      </button>
                      <button
                        type="button"
                        onClick={() => setSignupRole('worker')}
                        className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                          signupRole === 'worker'
                            ? 'bg-white dark:bg-slate-900 text-purple-700 dark:text-purple-400 shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        <Briefcase size={16} /> Worker
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {signupRole === 'candidate'
                        ? 'Candidate account for taking certification tests and receiving credentials.'
                        : 'Worker account for specialized worker evaluations and workforce tasks.'}
                    </p>
                  </div>
                ) : (
                  <div
                    className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                      forcedRole === 'worker'
                        ? 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800 text-purple-900 dark:text-purple-200'
                        : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200'
                    }`}
                  >
                    <span className="font-medium">
                      Account Type:{' '}
                      <strong className="font-bold">
                        {forcedRole === 'worker' ? 'Verified Worker' : 'Certification Candidate'}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(forcedRole === 'worker' ? '/candidate/signup' : '/worker/signup')
                      }
                      className="underline font-semibold hover:opacity-80"
                    >
                      Switch to {forcedRole === 'worker' ? 'Candidate' : 'Worker'}
                    </button>
                  </div>
                )}

                <div>
                  <Label>Full Name</Label>
                  <div className="relative">
                    <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={isWorker ? 'Alex Staff' : 'Jane Doe'}
                      className="pl-10"
                    />
                  </div>
                </div>
              </>
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

            <Button
              type="submit"
              disabled={loading}
              className={`w-full ${
                isWorker
                  ? 'bg-purple-600 hover:bg-purple-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
              size="lg"
            >
              {loading ? (
                <Spinner />
              ) : isSignup ? (
                isWorker ? (
                  'Create Worker Account'
                ) : (
                  'Create Candidate Account'
                )
              ) : isWorker ? (
                'Sign In as Worker'
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          {isSignup ? (
            <div className="mt-6 space-y-2 text-center text-sm">
              <p className="text-slate-500 dark:text-slate-400">
                Already have an account?{' '}
                <button
                  onClick={() => navigate(isWorker ? '/worker/login' : '/login')}
                  className={`font-semibold hover:underline ${
                    isWorker ? 'text-purple-600 dark:text-purple-400' : 'text-blue-600 dark:text-blue-400'
                  }`}
                >
                  Sign in
                </button>
              </p>
              {isWorker ? (
                <p className="text-xs text-slate-400">
                  Candidate seeking certification?{' '}
                  <button
                    onClick={() => navigate('/candidate/signup')}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Sign up as Candidate
                  </button>
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  Staff or contractor?{' '}
                  <button
                    onClick={() => navigate('/worker/signup')}
                    className="text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    Sign up as Worker
                  </button>
                </p>
              )}
            </div>
          ) : (
            <div className="mt-6 space-y-2 text-center text-sm">
              <p className="text-slate-500 dark:text-slate-400">
                Don't have an account?{' '}
                <button
                  onClick={() => navigate(isWorker ? '/worker/signup' : '/signup')}
                  className={`font-semibold hover:underline ${
                    isWorker ? 'text-purple-600 dark:text-purple-400' : 'text-blue-600 dark:text-blue-400'
                  }`}
                >
                  {isWorker ? 'Sign up as Worker' : 'Sign up'}
                </button>
              </p>
              {isWorker ? (
                <p className="text-xs text-slate-400">
                  Are you a candidate?{' '}
                  <button
                    onClick={() => navigate('/login')}
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Candidate Sign In
                  </button>
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  Are you a worker?{' '}
                  <button
                    onClick={() => navigate('/worker/login')}
                    className="text-purple-600 dark:text-purple-400 hover:underline"
                  >
                    Worker Sign In
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
            'Access Denied: You do not have administrative privileges. Candidates and Workers must sign in using the Candidate & Worker Portal.'
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
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white mb-3 shadow-xl shadow-blue-900/40 border border-blue-500/30">
              <ShieldCheck size={28} />
            </div>

            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-slate-800 text-blue-300 border border-slate-700 mb-2">
              <Key size={12} className="text-blue-400" />
              <span>Restricted • Authorized Administrators Only</span>
            </div>

            <h1 className="text-2xl font-bold text-white font-serif tracking-tight">Admin Portal</h1>
            <p className="text-sm text-slate-400 mt-1 text-center">
              System administration, evaluation management, and proctoring
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3.5 mb-5 rounded-xl bg-red-950/60 border border-red-800 text-sm text-red-200 animate-fade-in">
              <AlertCircle size={18} className="shrink-0 mt-0.5 text-red-400" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="text-slate-300">Administrator Email</Label>
              <div className="relative">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@organization.com"
                  className="pl-10 bg-slate-950/70 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <Label className="text-slate-300">Password</Label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-10 bg-slate-950/70 border-slate-700 text-white placeholder-slate-500 focus:border-blue-500"
                  minLength={6}
                />
              </div>
            </div>

            <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500" size="lg">
              {loading ? <Spinner /> : 'Authenticate as Administrator'}
            </Button>
          </form>

          <p className="text-center text-xs text-slate-500 mt-6">
            First time setup?{' '}
            <button
              onClick={() => navigate('/bootstrap')}
              className="text-blue-400 font-medium hover:underline"
            >
              Initialize Super Admin
            </button>
          </p>
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
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/admin-api/bootstrap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
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
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 text-slate-100">
        <div className="bg-slate-900 rounded-2xl shadow-xl border border-slate-800 p-8 max-w-md w-full text-center animate-scale-in">
          <div className="w-16 h-16 rounded-full bg-emerald-950/60 border border-emerald-800 flex items-center justify-center text-emerald-400 mx-auto mb-4">
            <ShieldCheck size={32} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Super Admin Initialized</h2>
          <p className="text-sm text-slate-300 mb-6">
            Your super administrator account has been created. You can now authenticate via the Admin Portal.
          </p>
          <Button onClick={() => navigate('/admin')} className="w-full">
            Proceed to Admin Sign In
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-900 via-slate-950 to-blue-950 text-slate-100">
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
        <div className="bg-slate-900 rounded-2xl shadow-xl border border-slate-800 p-8 animate-fade-in">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-blue-700 flex items-center justify-center text-white mb-3 shadow-lg shadow-blue-700/20">
              <ShieldCheck size={28} />
            </div>
            <h1 className="text-2xl font-bold text-white font-serif">Create Super Admin</h1>
            <p className="text-sm text-slate-400 mt-1">Set up the initial system owner account</p>
          </div>
          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-red-950/50 border border-red-800 text-sm text-red-200">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <form onSubmit={handleBootstrap} className="space-y-4">
            <div>
              <Label className="text-slate-300">Full Name</Label>
              <Input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Super Admin"
                className="bg-slate-950/70 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label className="text-slate-300">Email Address</Label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="bg-slate-950/70 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label className="text-slate-300">Password</Label>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                className="bg-slate-950/70 border-slate-700 text-white"
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500" size="lg">
              {loading ? <Spinner /> : 'Create Super Admin'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

// Backward compatibility alias
export function AuthPage({ mode }: { mode: 'candidate-login' | 'candidate-signup' | 'admin-login' | 'bootstrap' }) {
  if (mode === 'admin-login') return <AdminAuthPage />;
  if (mode === 'candidate-signup') return <CandidateAuthPage mode="signup" />;
  if (mode === 'bootstrap') return <BootstrapPage />;
  return <CandidateAuthPage mode="login" />;
}
