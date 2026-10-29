import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { ThemeToggle } from '@/lib/theme';
import { Spinner } from '@/components/ui';
import { ClipboardCheck, LogOut, LayoutDashboard, FileText, Users, ShieldCheck, BarChart3, ScrollText, GraduationCap, Briefcase } from 'lucide-react';
import type { Role } from '@/types';

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <Spinner size={32} />
    </div>
  );
}

export function RouteGuard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { profile, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!profile) {
    navigate('/');
    return <LoadingScreen />;
  }
  if ((profile.role === 'candidate' || profile.role === 'worker') && profile.status === 'pending') {
    navigate('/pending-approval');
    return <LoadingScreen />;
  }
  if (!roles.includes(profile.role)) {
    navigate('/');
    return <LoadingScreen />;
  }
  return <>{children}</>;
}

const adminNav = [
  { path: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: null },
  { path: '/admin/tests', label: 'Tests', icon: FileText, perm: 'can-manage-tests' },
  { path: '/admin/users', label: 'Candidates', icon: Users, perm: 'can-manage-users' },
  { path: '/admin/workers', label: 'Workers', icon: Briefcase, perm: 'can-manage-users' },
  { path: '/admin/admins', label: 'Admins', icon: ShieldCheck, perm: null, superOnly: true },
  { path: '/admin/results', label: 'Results', icon: BarChart3, perm: 'can-view-reports' },
  { path: '/admin/audit', label: 'Audit Log', icon: ScrollText, perm: null },
];

export function AdminLayout({ children, current }: { children: ReactNode; current: string }) {
  const { profile, signOut } = useAuth();
  if (!profile) return null;

  const isSuper = profile.role === 'super_admin';
  const hasPerm = (p: string | null) => !p || isSuper || profile.permissions.includes(p);

  const navItems = adminNav.filter((item) => {
    if (item.superOnly && !isSuper) return false;
    return hasPerm(item.perm);
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex transition-colors">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800/80 flex flex-col fixed h-screen z-30 transition-colors shadow-xs">
        <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center gap-3 group text-left">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-700 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 group-hover:scale-105 transition-transform shrink-0">
              <ClipboardCheck size={20} />
            </div>
            <div>
              <span className="block font-bold text-slate-900 dark:text-white font-serif leading-none tracking-tight">Rater-X</span>
              <span className="text-[10px] uppercase font-semibold text-blue-600 dark:text-blue-400 tracking-wider">Evaluation Hub</span>
            </div>
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = current === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 shadow-2xs border border-blue-200/60 dark:border-blue-800/60'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100/80 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <item.icon size={18} className={active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="px-3.5 py-4 border-t border-slate-200/80 dark:border-slate-800/80 space-y-3 bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center justify-between px-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Appearance</span>
            <ThemeToggle />
          </div>
          <div className="p-3 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center text-xs font-bold uppercase shrink-0 shadow-xs">
                {profile.name?.charAt(0) || 'A'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{profile.name || 'Admin'}</p>
                <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 truncate uppercase tracking-wider">
                  {isSuper ? 'Super Admin' : 'Admin'}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={async () => { await signOut(); navigate('/'); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 ml-64">
        <main className="p-6 lg:p-8 max-w-7xl">{children}</main>
      </div>
    </div>
  );
}

export function CandidateLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  if (!profile) return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors">
      <header className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 sticky top-0 z-40 transition-colors">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/candidate')} className="flex items-center gap-3 text-left group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-700 via-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <GraduationCap size={20} />
            </div>
            <div>
              <span className="block font-bold text-slate-900 dark:text-white font-serif leading-none tracking-tight">Rater-X</span>
              <span className="text-[10px] uppercase font-semibold text-blue-600 dark:text-blue-400 tracking-wider">
                Candidate Assessment Hub
              </span>
            </div>
          </button>
          <div className="flex items-center gap-3 sm:gap-4">
            <ThemeToggle />
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{profile.name || 'Candidate'}</p>
              <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 capitalize">Candidate</p>
            </div>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-2xs bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
              <GraduationCap size={18} />
            </div>
            <button
              onClick={async () => { await signOut(); navigate('/'); }}
              className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              title="Sign Out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}

export function WorkerLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  if (!profile) return null;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors">
      <header className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-purple-200/80 dark:border-purple-900/50 sticky top-0 z-40 transition-colors shadow-2xs">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/worker')} className="flex items-center gap-3 text-left group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-700 via-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-purple-500/20 group-hover:scale-105 transition-transform">
              <Briefcase size={20} />
            </div>
            <div>
              <span className="block font-bold text-slate-900 dark:text-white font-serif leading-none tracking-tight">Rater-X</span>
              <span className="text-[10px] uppercase font-semibold text-purple-600 dark:text-purple-400 tracking-wider">
                Worker Operations Hub
              </span>
            </div>
          </button>
          <div className="flex items-center gap-3 sm:gap-4">
            <ThemeToggle />
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{profile.name || 'Worker'}</p>
              <p className="text-xs font-semibold text-purple-600 dark:text-purple-400">Verified Worker</p>
            </div>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-2xs bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
              <Briefcase size={18} />
            </div>
            <button
              onClick={async () => { await signOut(); navigate('/'); }}
              className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              title="Sign Out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
