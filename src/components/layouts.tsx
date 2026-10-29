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
      <aside className="w-60 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col fixed h-screen z-30 transition-colors">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <button onClick={() => navigate('/')} className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-700 flex items-center justify-center text-white">
              <ClipboardCheck size={18} />
            </div>
            <span className="font-bold text-slate-900 dark:text-white font-serif">Rater X</span>
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = current === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <item.icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="px-3 py-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between px-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Theme</span>
            <ThemeToggle />
          </div>
          <div className="px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{profile.name || 'Admin'}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{isSuper ? 'Super Admin' : 'Administrator'}</p>
          </div>
          <button
            onClick={async () => { await signOut(); navigate('/'); }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 ml-60">
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
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40 transition-colors">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => navigate('/candidate')} className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-700 flex items-center justify-center text-white">
              <ClipboardCheck size={18} />
            </div>
            <span className="font-bold text-slate-900 dark:text-white font-serif">Rater X</span>
          </button>
          <div className="flex items-center gap-3 sm:gap-4">
            <ThemeToggle />
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{profile.name || 'User'}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">{profile.role}</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-700 dark:text-blue-300">
              {profile.role === 'worker' ? <Briefcase size={18} /> : <GraduationCap size={18} />}
            </div>
            <button
              onClick={async () => { await signOut(); navigate('/'); }}
              className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
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
