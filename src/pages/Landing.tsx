import { navigate } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/lib/theme';
import { Button, Badge } from '@/components/ui';
import { ArrowRight, Lock, FileText, Clock, BarChart3, ShieldCheck, CheckCircle2, Briefcase, GraduationCap, Sparkles } from 'lucide-react';

export function LandingPage() {
  const { user, profile } = useAuth();

  const goToDashboard = () => {
    if (!user) return;
    if (profile?.role === 'candidate' || profile?.role === 'worker') navigate('/candidate');
    else if (profile?.role === 'admin' || profile?.role === 'super_admin') navigate('/admin/dashboard');
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 flex flex-col transition-colors">
      {/* Header */}
      <header className="border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.18142vv4cndxn.svg" alt="Rater X" className="h-8 w-auto" />
            <span className="hidden sm:inline-block text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-full border border-blue-200/60 dark:border-blue-800/60">
              Enterprise Evaluation
            </span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            {user && profile ? (
              <Button size="sm" onClick={goToDashboard}>
                Go to Dashboard <ArrowRight size={15} />
              </Button>
            ) : (
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  onClick={() => navigate('/login')}
                  className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Sign In
                </button>
                <Button size="sm" onClick={() => navigate('/signup')}>
                  Get Started <ArrowRight size={14} />
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden flex-1 flex items-center py-16 lg:py-24">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/50 via-white to-slate-50 dark:from-blue-950/20 dark:via-slate-950 dark:to-slate-950" />
        <div className="relative max-w-7xl mx-auto px-6 w-full">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800/60 text-xs font-semibold text-blue-700 dark:text-blue-300 mb-6 shadow-2xs">
              <Sparkles size={14} className="text-blue-600 dark:text-blue-400" />
              <span>Next-Gen Certification & Assessment System</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-slate-900 dark:text-white leading-[1.15] mb-6 font-serif tracking-tight">
              Professional Testing & Certification Evaluation
            </h1>

            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed mb-10 max-w-2xl mx-auto">
              Secure, high-fidelity assessments for candidates and workers with timed sections, high-resolution visual questions, touch zoom, auto & manual grading, and instant accredited certificates.
            </p>

            <div className="flex flex-col sm:flex-row gap-3.5 justify-center max-w-md mx-auto">
              <Button size="lg" onClick={() => navigate('/signup')} className="w-full sm:w-auto">
                Register as Candidate or Worker <ArrowRight size={16} />
              </Button>
              <Button size="lg" variant="secondary" onClick={() => navigate('/login')} className="w-full sm:w-auto">
                Sign In
              </Button>
            </div>

            {/* Credibility badges */}
            <div className="flex flex-wrap items-center justify-center gap-6 mt-12 text-xs font-medium text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-emerald-500" /> Timed Section Control
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-emerald-500" /> Role-Targeted Assessments
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={16} className="text-emerald-500" /> PDF Accredited Reports
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Roles & Audience Features */}
      <section className="max-w-7xl mx-auto px-6 py-14 border-t border-slate-200/80 dark:border-slate-800/80">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl font-bold font-serif text-slate-900 dark:text-white mb-2">Built for Excellence</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">A unified platform tailored with dedicated portals for Candidates and Workers</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          <div className="p-6 rounded-2xl border border-blue-200/80 dark:border-blue-900/60 bg-gradient-to-br from-blue-50/60 via-white to-blue-50/20 dark:from-blue-950/40 dark:via-slate-900 dark:to-slate-900 shadow-xs">
            <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center mb-4 shadow-sm shadow-blue-500/20">
              <GraduationCap size={24} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Candidate Portal</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
              Access scheduled certifications, view pass/fail statistics, retake assessments when allowed by test policy, and print accredited PDF credentials.
            </p>
            <button onClick={() => navigate('/signup')} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline">
              Join as Candidate <ArrowRight size={14} />
            </button>
          </div>

          <div className="p-6 rounded-2xl border border-purple-200/80 dark:border-purple-900/60 bg-gradient-to-br from-purple-50/60 via-white to-purple-50/20 dark:from-purple-950/40 dark:via-slate-900 dark:to-slate-900 shadow-xs">
            <div className="w-12 h-12 rounded-xl bg-purple-600 text-white flex items-center justify-center mb-4 shadow-sm shadow-purple-500/20">
              <Briefcase size={24} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Worker Portal</h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-4">
              Specialized evaluation tracks for staff and contractors. Complete verification tests, timed challenges, and track performance records with complete transparency.
            </p>
            <button onClick={() => navigate('/signup')} className="inline-flex items-center gap-1 text-sm font-semibold text-purple-600 dark:text-purple-400 hover:underline">
              Join as Worker <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: FileText, title: 'Image-Based Questions', desc: 'Clear visual questions with pinch-to-zoom on mobile, reference external links, and multiple choice.' },
            { icon: Clock, title: 'Timed Sections', desc: 'Each section is independently timed with real-time countdown and automatic submission on expiration.' },
            { icon: BarChart3, title: 'Accredited PDF Results', desc: 'Review score summaries, manual grader feedback, and export clean, printable PDF certificates.' },
          ].map((f) => (
            <div key={f.title} className="p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:shadow-md transition-all">
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4 border border-blue-200/60 dark:border-blue-800/60">
                <f.icon size={20} />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white mb-2">{f.title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200/80 dark:border-slate-800/80 py-8 bg-slate-50/50 dark:bg-slate-900/40">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/logo.18142vv4cndxn.svg" alt="Rater X" className="h-7 w-auto" />
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">© {new Date().getFullYear()} Rater-X Evaluation Platform. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/admin')}
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors font-semibold"
              title="Administrator access"
            >
              <Lock size={12} /> Admin Portal
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
