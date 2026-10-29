import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { ThemeToggle } from '@/lib/theme';
import { Button, Input, Label, Spinner } from '@/components/ui';
import { GraduationCap, Mail, Lock, User, ArrowLeft, AlertCircle, Sparkles } from 'lucide-react';

export function CandidateAuthPage({ mode = 'login' }: { mode?: 'login' | 'signup' }) {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isSignup = mode === 'signup';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignup) {
        if (!name.trim()) throw new Error('Please provide your full name');
        // Strictly register as candidate
        await signUp(email.trim(), password, name.trim(), 'candidate');
      } else {
        const { data: authData, error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInErr) throw signInErr;
        if (!authData.user) throw new Error('Sign in failed');

        // Check profile
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
              'Administrative accounts must use the Admin Portal link in the footer.'
            );
          }
          if (prof.role === 'worker') {
            await supabase.auth.signOut();
            throw new Error(
              'This account is registered as a Worker. Please sign in via the Worker Operations Portal.'
            );
          }
          if (prof.status === 'disabled') {
            await supabase.auth.signOut();
            throw new Error('Your candidate account has been disabled. Please contact system support.');
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/20 transition-colors">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <ArrowLeft size={16} /> Back to home
          </button>
          <ThemeToggle />
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-blue-200/80 dark:border-blue-900/60 p-8 animate-fade-in transition-colors">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white flex items-center justify-center mb-3 shadow-lg shadow-blue-600/25">
              <GraduationCap size={28} />
            </div>
            <div className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 mb-2">
              <Sparkles size={12} /> Candidate Assessment Portal
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-serif">
              {isSignup ? 'Create Candidate Account' : 'Candidate Portal Sign In'}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 text-center">
              {isSignup
                ? 'Register to take scheduled certification exams, receive credentials, and view results'
                : 'Sign in to access your tests, examination countdowns, and certification credentials'}
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
                    className="pl-10 focus:border-blue-500 focus:ring-blue-500"
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
                  placeholder="candidate@example.com"
                  className="pl-10 focus:border-blue-500 focus:ring-blue-500"
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
                  className="pl-10 focus:border-blue-500 focus:ring-blue-500"
                  minLength={6}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md shadow-blue-600/20"
              size="lg"
            >
              {loading ? (
                <Spinner />
              ) : isSignup ? (
                'Create Candidate Account'
              ) : (
                'Sign In as Candidate'
              )}
            </Button>
          </form>

          {isSignup ? (
            <div className="mt-6 space-y-3 text-center text-sm">
              <p className="text-slate-500 dark:text-slate-400">
                Already have a candidate account?{' '}
                <button
                  onClick={() => navigate('/candidate/login')}
                  className="text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                >
                  Sign in
                </button>
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
                Are you a staff worker or contractor?{' '}
                <button
                  onClick={() => navigate('/worker/signup')}
                  className="text-purple-600 dark:text-purple-400 hover:underline font-medium"
                >
                  Register as Worker
                </button>
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-3 text-center text-sm">
              <p className="text-slate-500 dark:text-slate-400">
                Don't have a candidate account?{' '}
                <button
                  onClick={() => navigate('/candidate/signup')}
                  className="text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                >
                  Sign up as Candidate
                </button>
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
                Are you a staff worker or contractor?{' '}
                <button
                  onClick={() => navigate('/worker/login')}
                  className="text-purple-600 dark:text-purple-400 hover:underline font-medium"
                >
                  Worker Sign In
                </button>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

