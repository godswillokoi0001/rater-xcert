import { navigate } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/lib/theme';
import { Button } from '@/components/ui';
import { ArrowRight, Lock, FileText, Clock, BarChart3 } from 'lucide-react';

export function LandingPage() {
  const { user, profile } = useAuth();

  const goToDashboard = () => {
    if (!user) return;
    if (profile?.role === 'candidate') navigate('/candidate');
    else if (profile?.role === 'admin' || profile?.role === 'super_admin') navigate('/admin/dashboard');
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex flex-col transition-colors">
      {/* Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.18142vv4cndxn.svg" alt="Rater X" className="h-9 w-auto" />
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {user && profile ? (
              <Button size="sm" onClick={goToDashboard}>
                Go to Dashboard <ArrowRight size={16} />
              </Button>
            ) : (
              <div className="flex items-center gap-3">
                <button onClick={() => navigate('/login')} className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors">
                  Sign In
                </button>
                <Button size="sm" onClick={() => navigate('/signup')}>Get Started</Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden flex-1 flex items-center">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-blue-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/20" />
        <div className="relative max-w-7xl mx-auto px-6 py-20 lg:py-28 w-full">
          <div className="max-w-3xl mx-auto text-center">
            <div className="flex justify-center mb-8">
              <img src="/logo.18142vv4cndxn.svg" alt="Rater X" className="h-16 w-auto" />
            </div>
            <h1 className="text-4xl lg:text-5xl font-bold text-slate-900 dark:text-white leading-tight mb-6 font-serif">
              Rater-X Evaluation Hub
            </h1>
            <p className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed mb-10 max-w-2xl mx-auto">
              A secure, professional platform for certification exams. Sign in to access your
              assigned tests, complete evaluations with confidence, and track your results.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" onClick={() => navigate('/signup')}>
                Create Account <ArrowRight size={18} />
              </Button>
              <Button size="lg" variant="secondary" onClick={() => navigate('/login')}>
                Sign In
              </Button>
            </div>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-6">
              New candidates must be approved by an administrator before accessing tests.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-6 py-16 border-t border-slate-100 dark:border-slate-800">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: FileText, title: 'Image-Based Questions', desc: 'Clear, visual exam questions with multiple-choice answers, zoom capabilities, and reference links.' },
            { icon: Clock, title: 'Timed Sections', desc: 'Each section is independently timed with automatic submission when time expires.' },
            { icon: BarChart3, title: 'Result Tracking & Reports', desc: 'View past attempts, retake failed tests, and generate official PDF printable reports.' },
          ].map((f) => (
            <div key={f.title} className="p-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-md transition-all">
              <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/50 flex items-center justify-center text-blue-700 dark:text-blue-300 mb-4">
                <f.icon size={20} />
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-white mb-2">{f.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 py-8">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.18142vv4cndxn.svg" alt="Rater X" className="h-7 w-auto" />
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/admin')}
              className="inline-flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              title="Administrator access"
            >
              <Lock size={12} /> Admin
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
