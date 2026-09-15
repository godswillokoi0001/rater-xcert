import { useEffect, useState, useCallback } from 'react';
import { supabase, callAdminApi } from '@/lib/supabase';
import { RouteGuard, AdminLayout } from '@/components/layouts';
import { Button, Card, Badge, Input, Modal, Spinner, EmptyState, ConfirmDialog } from '@/components/ui';
import type { Profile } from '@/types';
import { Users, Search, Trash2, UserCheck, UserX, Edit3, Mail } from 'lucide-react';

export function AdminUsersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editTarget, setEditTarget] = useState<Profile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').eq('role', 'candidate').order('created_at', { ascending: false });
    setProfiles((data || []) as Profile[]);
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
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 font-serif mb-1">User Management</h1>
          <p className="text-sm text-slate-500">View, edit, and manage candidate accounts</p>
        </div>

        <Card className="p-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email..." className="pl-10" />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </Card>

        {filtered.length === 0 ? (
          <Card><EmptyState icon={<Users size={28} />} title="No users found" description="No candidates match your search." /></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Name</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider hidden sm:table-cell">Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider hidden md:table-cell">Joined</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider hidden lg:table-cell">Last Login</th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-sm font-medium">
                            {p.name?.charAt(0).toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{p.name || 'Unnamed'}</p>
                            <p className="text-xs text-slate-500 flex items-center gap-1"><Mail size={10} /> {p.email || '—'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 hidden sm:table-cell">
                        <Badge color={p.status === 'active' ? 'green' : p.status === 'pending' ? 'amber' : 'red'}>{p.status}</Badge>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 hidden md:table-cell">
                        {new Date(p.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 hidden lg:table-cell">
                        {p.last_login ? new Date(p.last_login).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          {p.status === 'pending' && (
                            <Button size="sm" variant="success" onClick={() => handleApprove(p)} title="Approve candidate">
                              <UserCheck size={14} /> Approve
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setEditTarget(p)}><Edit3 size={14} /></Button>
                          <Button size="sm" variant="ghost" onClick={() => handleToggleStatus(p)} title={p.status === 'active' ? 'Disable' : 'Enable'}>
                            {p.status === 'active' ? <UserX size={14} className="text-amber-600" /> : <UserCheck size={14} className="text-green-600" />}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(p)}><Trash2 size={14} className="text-red-500" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {editTarget && (
          <EditNameModal profile={editTarget} onClose={() => setEditTarget(null)} onSaved={() => { setEditTarget(null); fetchProfiles(); }} />
        )}

        <ConfirmDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title="Delete User"
          message={`Permanently delete "${deleteTarget?.name}"'s account? This removes all their data and cannot be undone.`}
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
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Full Name</label>
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
