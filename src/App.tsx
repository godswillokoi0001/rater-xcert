import { AuthProvider, useAuth } from '@/lib/auth';
import { ThemeProvider } from '@/lib/theme';
import { useHashRoute, navigate } from '@/lib/router';
import { LoadingScreen } from '@/components/layouts';
import { LandingPage } from '@/pages/Landing';
import { AuthPage, BootstrapPage } from '@/pages/Auth';
import { PendingApprovalPage } from '@/pages/PendingApproval';
import { CandidateDashboard } from '@/pages/candidate/Dashboard';
import { TestTakingPage } from '@/pages/candidate/TakeTest';
import { AdminDashboard } from '@/pages/admin/Dashboard';
import { AdminTestsPage } from '@/pages/admin/Tests';
import { AdminUsersPage } from '@/pages/admin/Users';
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

  // Gate: if candidate is pending approval, force to pending-approval
  if (needsApproval && route !== '/pending-approval') {
    navigate('/pending-approval');
    return <LoadingScreen />;
  }

  if (route === '/pending-approval') {
    if (!user) { navigate('/login'); return <LoadingScreen />; }
    if (profile?.role !== 'candidate' || profile.status !== 'pending') {
      if (profile?.role === 'candidate') navigate('/candidate');
      else navigate('/admin/dashboard');
      return <LoadingScreen />;
    }
    return <PendingApprovalPage />;
  }

  if (route === '/login' || route === '/signup' || route === '/admin') {
    if (user && profile) {
      if (needsApproval) { navigate('/pending-approval'); return <LoadingScreen />; }
      if (profile.role === 'candidate') navigate('/candidate');
      else navigate('/admin/dashboard');
      return <LoadingScreen />;
    }
    if (route === '/login') return <AuthPage mode="candidate-login" />;
    if (route === '/signup') return <AuthPage mode="candidate-signup" />;
    if (route === '/admin') return <AuthPage mode="admin-login" />;
  }

  if (needsApproval) {
    navigate('/pending-approval');
    return <LoadingScreen />;
  }

  if (parts[0] === 'candidate') {
    if (!user || !profile) { navigate('/login'); return <LoadingScreen />; }
    if (profile.role !== 'candidate') { navigate('/admin/dashboard'); return <LoadingScreen />; }
    if (parts.length === 1) return <CandidateDashboard />;
    if (parts[1] === 'test' && parts[2]) return <TestTakingPage testId={parts[2]} />;
  }

  if (parts[0] === 'admin') {
    if (!user || !profile) { navigate('/admin'); return <LoadingScreen />; }
    if (profile.role !== 'admin' && profile.role !== 'super_admin') { navigate('/candidate'); return <LoadingScreen />; }
    if (parts[1] === 'dashboard') return <AdminDashboard />;
    if (parts[1] === 'tests') return <AdminTestsPage />;
    if (parts[1] === 'users') return <AdminUsersPage />;
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
