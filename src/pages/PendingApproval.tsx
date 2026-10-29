import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { ThemeToggle } from '@/lib/theme';
import { Button, Badge } from '@/components/ui';
import { Clock, LogOut, Mail, ArrowLeft, ShieldCheck, Briefcase, GraduationCap } from 'lucide-react';

export function PendingApprovalPage() {
  const { user, profile, signOut } = useAuth();
  const isWorker = profile?.role === 'worker';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950/20 transition-colors">
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

        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-200/80 dark:border-slate-800 p-8 text-center animate-fade-in transition-colors">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-200/60 dark:from-amber-950/50 dark:to-amber-900/40 border border-amber-200/80 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400 mx-auto mb-5 shadow-xs">
            <Clock size={32} />
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 mb-3">
            {isWorker ? <Briefcase size={12} /> : <GraduationCap size={12} />}
            <span>{isWorker ? 'Worker Account' : 'Candidate Account'}</span>
          </div>

          <h1 className="text-2xl font-bold font-serif text-slate-900 dark:text-white mb-2 tracking-tight">
            Awaiting Administrator Approval
          </h1>

          <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
            Your registration is received. An administrator will review and authorize your account before you can take assessments and access evaluations.
          </p>

          <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 mb-6 text-left border border-slate-200/70 dark:border-slate-700/60">
            <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 mb-2 font-medium">
              <Mail size={16} className="text-slate-400 dark:text-slate-500 shrink-0" />
              <span className="truncate">{user?.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge color="amber" dot>
                Status: Pending Admin Review
              </Badge>
            </div>
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500 mb-6 leading-relaxed">
            Approvals are handled quickly. Please check back shortly or contact your evaluation administrator for expedited access.
          </p>

          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              await signOut();
              navigate('/');
            }}
          >
            <LogOut size={16} /> Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
