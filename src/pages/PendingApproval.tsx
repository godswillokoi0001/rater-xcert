import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { Button } from '@/components/ui';
import { Clock, LogOut, Mail } from 'lucide-react';

export function PendingApprovalPage() {
  const { user, profile, signOut } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 mx-auto mb-4">
            <Clock size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 font-serif mb-2">Awaiting Admin Approval</h1>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            Your email has been verified successfully. An administrator needs to approve
            your account before you can access your dashboard and take tests.
          </p>

          <div className="bg-slate-50 rounded-lg p-4 mb-6 text-left">
            <div className="flex items-center gap-2 text-sm text-slate-600 mb-1">
              <Mail size={16} className="text-slate-400" />
              <span>{user?.email}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
                <Clock size={12} /> Pending Approval
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-6">
            You'll be able to access your dashboard once an admin approves your account.
            Please check back later or contact your administrator.
          </p>

          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => { await signOut(); navigate('/'); }}
          >
            <LogOut size={16} /> Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
