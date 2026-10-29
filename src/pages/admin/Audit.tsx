import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { RouteGuard, AdminLayout } from '@/components/layouts';
import { Card, Badge, Spinner, EmptyState, Input, Select } from '@/components/ui';
import type { AuditLog } from '@/types';
import { ScrollText, Search, Activity } from 'lucide-react';

export function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200);
    setLogs((data || []) as AuditLog[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const filtered = logs.filter((l) => {
    const matchesSearch = !search || l.action.toLowerCase().includes(search.toLowerCase()) || l.admin_name.toLowerCase().includes(search.toLowerCase());
    const matchesEntity = entityFilter === 'all' || l.entity_type === entityFilter;
    return matchesSearch && matchesEntity;
  });

  const entityTypes = [...new Set(logs.map((l) => l.entity_type))].filter(Boolean);

  if (loading) return <RouteGuard roles={['admin', 'super_admin']}><AdminLayout current="/admin/audit"><div className="flex justify-center py-20"><Spinner size={32} /></div></AdminLayout></RouteGuard>;

  return (
    <RouteGuard roles={['admin', 'super_admin']}>
      <AdminLayout current="/admin/audit">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-serif mb-1">Audit Log</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Track every administrative action</p>
        </div>

        <Card className="p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by action or admin name..." className="pl-10" />
            </div>
            <div className="flex-1 min-w-[150px]">
              <Select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
                <option value="all">All Types</option>
                {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
          </div>
        </Card>

        {filtered.length === 0 ? (
          <Card><EmptyState icon={<ScrollText size={28} />} title="No audit entries" description="Administrative actions will be recorded here." /></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Admin</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Action</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider hidden sm:table-cell">Entity</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider hidden md:table-cell">Details</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-5 py-3.5 text-sm font-medium text-slate-900 dark:text-white">{log.admin_name || 'Unknown'}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-700 dark:text-slate-200">{log.action.replace(/_/g, ' ')}</td>
                      <td className="px-5 py-3.5 hidden sm:table-cell"><Badge color="slate">{log.entity_type}</Badge></td>
                      <td className="px-5 py-3.5 text-xs text-slate-500 dark:text-slate-400 hidden md:table-cell max-w-xs truncate">
                        {Object.keys(log.details || {}).length > 0 ? JSON.stringify(log.details) : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400">
                        {new Date(log.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </AdminLayout>
    </RouteGuard>
  );
}
