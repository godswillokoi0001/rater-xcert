import { AuthProvider, useAuth } from '@/lib/auth';
import { ThemeProvider } from '@/lib/theme';
import { useHashRoute, navigate } from '@/lib/router';
import { LoadingScreen } from '@/components/layouts';
import { LandingPage } from '@/pages/Landing';
import { CandidateAuthPage, AdminAuthPage, BootstrapPage } from '@/pages/Auth';
import { PendingApprovalPage } from '@/pages/PendingApproval';
import { CandidateDashboard } from '@/pages/candidate/Dashboard';
import { TestTakingPage } from '@/pages/candidate/TakeTest';
import { AdminDashboard } from '@/pages/admin/Dashboard';
import { AdminTestsPage } from '@/pages/admin/Tests';
import { AdminUsersPage } from '@/pages/admin/Users';
import { AdminWorkersPage } from '@/pages/admin/Workers';
import { AdminAdminsPage } from '@/pages/admin/Admins';
import { AdminResultsPage } from '@/pages/admin/Results';
import { AdminAuditPage } from '@/pages/admin/Audit';

function Router() {
  const { route } = useHashRoute();
  const { user, profile, loading, profileLoading, needsApproval } = useAuth();

  if (loading) return <LoadingScreen />;

  if (user && !profile && profileLoading) return <LoadingScreen />;

  const parts = route.split('/').filter(Boolean);

  if (route === '/' || route === '') return <LandingPage />;

  if (route === '/bootstrap') return <BootstrapPage />;

  // Gate: if candidate or worker is pending approval, force to pending-approval
  if (needsApproval && route !== '/pending-approval') {
    navigate('/pending-approval');
    return <LoadingScreen />;
  }

  if (route === '/pending-approval') {
    if (!user) { navigate('/login'); return <LoadingScreen />; }
    if ((profile?.role !== 'candidate' && profile?.role !== 'worker') || profile.status !== 'pending') {
      if (profile?.role === 'candidate' || profile?.role === 'worker') navigate('/candidate');
      else navigate('/admin/dashboard');
      return <LoadingScreen />;
    }
    return <PendingApprovalPage />;
  }

  // Candidate and Worker Auth: Strictly for candidate and worker accounts
  if (route === '/login' || route === '/signup') {
    if (user && profile) {
      if (needsApproval) { navigate('/pending-approval'); return <LoadingScreen />; }
      if (profile.role === 'candidate' || profile.role === 'worker') {
        navigate('/candidate');
        return <LoadingScreen />;
      }
      navigate('/admin/dashboard');
      return <LoadingScreen />;
    }
    if (route === '/login') return <CandidateAuthPage mode="login" />;
    if (route === '/signup') return <CandidateAuthPage mode="signup" />;
  }

  // Admin Auth: Accessible via /admin or /admin/login (linked exclusively at footer)
  if (route === '/admin' || route === '/admin/login') {
    if (user && profile) {
      if (profile.role === 'admin' || profile.role === 'super_admin') {
        navigate('/admin/dashboard');
        return <LoadingScreen />;
      }
      navigate('/candidate');
      return <LoadingScreen />;
    }
    return <AdminAuthPage />;
  }

  if (needsApproval) {
    navigate('/pending-approval');
    return <LoadingScreen />;
  }

  if (parts[0] === 'candidate' || parts[0] === 'worker') {
    if (!user || !profile) { navigate('/login'); return <LoadingScreen />; }
    if (profile.role !== 'candidate' && profile.role !== 'worker') { navigate('/admin/dashboard'); return <LoadingScreen />; }
    if (parts.length === 1) return <CandidateDashboard />;
    if (parts[1] === 'test' && parts[2]) return <TestTakingPage testId={parts[2]} />;
  }

  if (parts[0] === 'admin') {
    if (parts[1] === 'login') return <AdminAuthPage />;
    if (!user || !profile) { navigate('/admin/login'); return <LoadingScreen />; }
    if (profile.role !== 'admin' && profile.role !== 'super_admin') { navigate('/candidate'); return <LoadingScreen />; }
    if (parts[1] === 'dashboard') return <AdminDashboard />;
    if (parts[1] === 'tests') return <AdminTestsPage />;
    if (parts[1] === 'users') return <AdminUsersPage />;
    if (parts[1] === 'workers') return <AdminWorkersPage />;
    if (parts[1] === 'admins') return <AdminAdminsPage />;
    if (parts[1] === 'results') return <AdminResultsPage />;
    if (parts[1] === 'audit') return <AdminAuditPage />;
    navigate('/admin/dashboard');
    return <LoadingScreen />;
  }

  return <LandingPage />;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
