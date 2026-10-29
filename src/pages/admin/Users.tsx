import { useEffect, useState, useCallback } from 'react';
import { supabase, callAdminApi } from '@/lib/supabase';
import { RouteGuard, AdminLayout } from '@/components/layouts';
import { Button, Card, Badge, Input, Modal, Spinner, EmptyState, ConfirmDialog } from '@/components/ui';
import { UserDetailsModal } from '@/components/UserDetailsModal';
import { CreateAccountModal } from '@/components/CreateAccountModal';
import type { Profile } from '@/types';
import { Users, Search, Trash2, UserCheck, UserX, Edit3, Mail, Eye, Award, Plus, Briefcase } from 'lucide-react';

export function AdminUsersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [attemptCounts, setAttemptCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editTarget, setEditTarget] = useState<Profile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [selectedUserForDetails, setSelectedUserForDetails] = useState<Profile | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);

  const fetchProfiles = useCallback(async () => {
    const [{ data: profs }, { data: attemptsData }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'candidate').order('created_at', { ascending: false }),
      supabase.from('attempts').select('candidate_id'),
    ]);

    const counts: Record<string, number> = {};
    (attemptsData || []).forEach((a: { candidate_id: string }) => {
      counts[a.candidate_id] = (counts[a.candidate_id] || 0) + 1;
    });

    setProfiles((profs || []) as Profile[]);
    setAttemptCounts(counts);
    setLoading(false);
  }, []);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  const handleToggleStatus = async (profile: Profile) => {
    const newStatus = profile.status === 'active' ? 'disabled' : 'active';
    await supabase.rpc('update_user_status', { p_user_id: profile.id, p_status: newStatus });
    fetchProfiles();
  };

  const handleApprove = async (profile: Profile) => {
    await supabase.rpc('update_user_status', { p_user_id: profile.id, p_status: 'active' });
    fetchProfiles();
  };

  const handleSwitchToWorker = async (profile: Profile) => {
    try {
      try {
        await callAdminApi('update-user-role', 'POST', { userId: profile.id, role: 'worker' });
      } catch {
        await supabase.rpc('update_user_role', { p_user_id: profile.id, p_role: 'worker' });
      }
      fetchProfiles();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to switch role');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await callAdminApi('delete-auth-user', 'POST', { userId: deleteTarget.id, role: deleteTarget.role });
      setDeleteTarget(null);
      fetchProfiles();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const filtered = profiles.filter((p) => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.email && p.email.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  if (loading) return <RouteGuard roles={['admin', 'super_admin']}><AdminLayout current="/admin/users"><div className="flex justify-center py-20"><Spinner size={32} /></div></AdminLayout></RouteGuard>;

  return (
    <RouteGuard roles={['admin', 'super_admin']}>
      <AdminLayout current="/admin/users">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-serif mb-1">Candidate Management</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">View candidate profiles, tests written, and configure test access</p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Candidate
          </Button>
        </div>

        <Card className="p-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search candidate by name or email..." className="pl-10" />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </Card>

        {filtered.length === 0 ? (
          <Card><EmptyState icon={<Users size={28} />} title="No candidates found" description="No candidates match your search." /></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Candidate</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider hidden sm:table-cell">Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Tests Written</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider hidden md:table-cell">Joined</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider hidden lg:table-cell">Last Login</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((p) => {
                    const writtenCount = attemptCounts[p.id] || 0;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <button
                            onClick={() => setSelectedUserForDetails(p)}
                            className="flex items-center gap-3 text-left group"
                          >
                            <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950/60 flex items-center justify-center text-blue-700 dark:text-blue-300 text-sm font-medium shrink-0">
                              {p.name?.charAt(0).toUpperCase() || '?'}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                {p.name || 'Unnamed'}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                <Mail size={10} /> {p.email || '—'}
                              </p>
                            </div>
                          </button>
                        </td>
                        <td className="px-5 py-3.5 hidden sm:table-cell">
                          <Badge color={p.status === 'active' ? 'green' : p.status === 'pending' ? 'amber' : 'red'}>{p.status}</Badge>
                        </td>
                        <td className="px-5 py-3.5">
                          <button
                            onClick={() => setSelectedUserForDetails(p)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
                          >
                            <Award size={12} />
                            {writtenCount} {writtenCount === 1 ? 'test' : 'tests'}
                          </button>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400 hidden md:table-cell">
                          {new Date(p.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400 hidden lg:table-cell">
                          {p.last_login ? new Date(p.last_login).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {writtenCount > 0 ? (
                              <Button
                                size="sm"
                                onClick={() => setSelectedUserForDetails(p)}
                                className="bg-blue-600 hover:bg-blue-700 text-white"
                                title="Review tests written by candidate"
                              >
                                <Eye size={14} /> Review ({writtenCount})
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setSelectedUserForDetails(p)}
                                title="View details and manage test access"
                              >
                                <Eye size={14} /> Details
                              </Button>
                            )}
                            {p.status === 'pending' && (
                              <Button size="sm" variant="success" onClick={() => handleApprove(p)} title="Approve candidate">
                                <UserCheck size={14} /> Approve
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => handleSwitchToWorker(p)} title="Switch to Worker role" className="text-purple-600 dark:text-purple-400">
                              <Briefcase size={14} />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditTarget(p)} title="Edit Name"><Edit3 size={14} /></Button>
                            <Button size="sm" variant="ghost" onClick={() => handleToggleStatus(p)} title={p.status === 'active' ? 'Disable' : 'Enable'}>
                              {p.status === 'active' ? <UserX size={14} className="text-amber-600" /> : <UserCheck size={14} className="text-green-600" />}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(p)} title="Delete"><Trash2 size={14} className="text-red-500" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {selectedUserForDetails && (
          <UserDetailsModal
            user={selectedUserForDetails}
            onClose={() => setSelectedUserForDetails(null)}
            onUserUpdated={fetchProfiles}
          />
        )}

        {editTarget && (
          <EditNameModal profile={editTarget} onClose={() => setEditTarget(null)} onSaved={() => { setEditTarget(null); fetchProfiles(); }} />
        )}

        <CreateAccountModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={fetchProfiles}
          defaultRole="candidate"
        />

        <ConfirmDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title="Delete Candidate"
          message={`Permanently delete candidate "${deleteTarget?.name}"'s account? This removes all their attempts and access data.`}
          confirmLabel="Delete"
          danger
        />
      </AdminLayout>
    </RouteGuard>
  );
}

function EditNameModal({ profile, onClose, onSaved }: { profile: Profile; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(profile.name);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await supabase.rpc('update_user_name', { p_user_id: profile.id, p_name: name });
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open={true} onClose={onClose} title="Edit User Name">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Full Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? <Spinner /> : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}
