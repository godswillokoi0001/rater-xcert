import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { AdminLayout, RouteGuard } from '@/components/layouts';
import { Card, Spinner, Badge } from '@/components/ui';
import { Users, FileText, TrendingUp, Activity, ArrowRight, Clock } from 'lucide-react';
import type { AuditLog } from '@/types';

export function AdminDashboard() {
  const { profile } = useAuth();
  const [stats, setStats] = useState({ candidates: 0, tests: 0, avgScore: 0, attempts: 0 });
  const [recentActivity, setRecentActivity] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: candidates }, { data: tests }, { data: attempts }, { data: logs }] = await Promise.all([
        supabase.from('profiles').select('id').eq('role', 'candidate'),
        supabase.from('tests').select('id'),
        supabase.from('attempts').select('score'),
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(8),
      ]);

      const avgScore = attempts && attempts.length > 0
        ? Math.round((attempts.reduce((sum, a) => sum + Number(a.score), 0) / attempts.length) * 10) / 10
        : 0;

      setStats({
        candidates: candidates?.length || 0,
        tests: tests?.length || 0,
        avgScore,
        attempts: attempts?.length || 0,
      });
      setRecentActivity((logs || []) as AuditLog[]);
      setLoading(false);
    })();
  }, []);

  if (loading) return <RouteGuard roles={['admin', 'super_admin']}><AdminLayout current="/admin/dashboard"><div className="flex justify-center py-20"><Spinner size={32} /></div></AdminLayout></RouteGuard>;

  const isSuper = profile?.role === 'super_admin';
  const hasPerm = (p: string) => isSuper || profile?.permissions.includes(p) || false;

  return (
    <RouteGuard roles={['admin', 'super_admin']}>
      <AdminLayout current="/admin/dashboard">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 font-serif mb-1">Dashboard</h1>
          <p className="text-sm text-slate-500">Platform overview and recent activity</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-700">
                <Users size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{stats.candidates}</p>
                <p className="text-xs text-slate-500">Total Candidates</p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-cyan-50 flex items-center justify-center text-cyan-700">
                <FileText size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{stats.tests}</p>
                <p className="text-xs text-slate-500">Total Tests</p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
                <TrendingUp size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{stats.avgScore}%</p>
                <p className="text-xs text-slate-500">Average Score</p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center text-green-600">
                <Activity size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{stats.attempts}</p>
                <p className="text-xs text-slate-500">Total Attempts</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {hasPerm('can-manage-tests') && (
            <QuickLink icon={FileText} label="Manage Tests" desc="Create and edit certifications" onClick={() => navigate('/admin/tests')} />
          )}
          {hasPerm('can-manage-users') && (
            <QuickLink icon={Users} label="Manage Users" desc="View and manage candidates" onClick={() => navigate('/admin/users')} />
          )}
          {hasPerm('can-view-reports') && (
            <QuickLink icon={TrendingUp} label="View Results" desc="Scores and reports" onClick={() => navigate('/admin/results')} />
          )}
        </div>

        {/* Recent activity */}
        <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Clock size={18} className="text-slate-400" /> Recent Activity
        </h2>
        {recentActivity.length === 0 ? (
          <Card className="p-8 text-center text-sm text-slate-500">No recent activity</Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="divide-y divide-slate-100">
              {recentActivity.map((log) => (
                <div key={log.id} className="px-5 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
                      <Activity size={14} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        <span className="text-slate-600">{log.admin_name}</span> {formatAction(log.action)}
                      </p>
                      <p className="text-xs text-slate-400">{new Date(log.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                  <Badge color="slate">{log.entity_type}</Badge>
                </div>
              ))}
            </div>
          </Card>
        )}
      </AdminLayout>
    </RouteGuard>
  );
}

function QuickLink({ icon: Icon, label, desc, onClick }: { icon: typeof FileText; label: string; desc: string; onClick: () => void }) {
  return (
    <Card className="p-5 cursor-pointer hover:shadow-md transition-shadow" >
      <button onClick={onClick} className="w-full text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-700">
              <Icon size={20} />
            </div>
            <div>
              <p className="font-semibold text-slate-900">{label}</p>
              <p className="text-xs text-slate-500">{desc}</p>
            </div>
          </div>
          <ArrowRight size={18} className="text-slate-400" />
        </div>
      </button>
    </Card>
  );
}

function formatAction(action: string): string {
  return action.replace(/_/g, ' ');
}
