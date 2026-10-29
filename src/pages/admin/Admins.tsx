import { useEffect, useState, useCallback } from 'react';
import { supabase, callAdminApi } from '@/lib/supabase';
import { RouteGuard, AdminLayout } from '@/components/layouts';
import { Button, Card, Badge, Input, Label, Modal, Spinner, EmptyState, ConfirmDialog } from '@/components/ui';
import { CreateAccountModal } from '@/components/CreateAccountModal';
import { PERMISSIONS } from '@/types';
import type { Profile } from '@/types';
import { ShieldCheck, Plus, Trash2, UserCheck, UserX, Edit3, Mail, Key } from 'lucide-react';

export function AdminAdminsPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editPerms, setEditPerms] = useState<Profile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);

  const fetchAdmins = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').in('role', ['admin', 'super_admin']).order('created_at', { ascending: false });
    setProfiles((data || []) as Profile[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAdmins(); }, [fetchAdmins]);

  const handleToggleStatus = async (profile: Profile) => {
    if (profile.role === 'super_admin') return;
    const newStatus = profile.status === 'active' ? 'disabled' : 'active';
    await supabase.rpc('update_user_status', { p_user_id: profile.id, p_status: newStatus });
    fetchAdmins();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await callAdminApi('delete-auth-user', 'POST', { userId: deleteTarget.id, role: deleteTarget.role });
      setDeleteTarget(null);
      fetchAdmins();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete admin');
    }
  };

  if (loading) return <RouteGuard roles={['super_admin']}><AdminLayout current="/admin/admins"><div className="flex justify-center py-20"><Spinner size={32} /></div></AdminLayout></RouteGuard>;

  return (
    <RouteGuard roles={['super_admin']}>
      <AdminLayout current="/admin/admins">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-serif mb-1">Admin Management</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Create admin accounts and manage permissions</p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New Admin
          </Button>
        </div>

        {profiles.length === 0 ? (
          <Card><EmptyState icon={<ShieldCheck size={28} />} title="No admins" description="Create your first admin account." /></Card>
        ) : (
          <div className="space-y-3">
            {profiles.map((p) => (
              <Card key={p.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${p.role === 'super_admin' ? 'bg-slate-800 dark:bg-slate-700 text-white' : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'}`}>
                      {p.name?.charAt(0).toUpperCase() || '?'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{p.name || 'Unnamed'}</p>
                        <Badge color={p.role === 'super_admin' ? 'slate' : 'blue'}>{p.role === 'super_admin' ? 'Super Admin' : 'Admin'}</Badge>
                        {p.status === 'disabled' && <Badge color="red">disabled</Badge>}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5"><Mail size={10} /> {p.email || '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.role !== 'super_admin' && (
                      <>
                        <div className="flex flex-wrap gap-1 mr-2">
                          {p.permissions.length === 0 ? (
                            <span className="text-xs text-slate-400">No permissions</span>
                          ) : (
                            p.permissions.map((perm) => (
                              <span key={perm} className="px-2 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{perm.replace('can-', '').replace('-', ' ')}</span>
                            ))
                          )}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setEditPerms(p)} title="Edit permissions"><Key size={14} /></Button>
                        <Button size="sm" variant="ghost" onClick={() => handleToggleStatus(p)} title={p.status === 'active' ? 'Disable' : 'Enable'}>
                          {p.status === 'active' ? <UserX size={14} className="text-amber-600" /> : <UserCheck size={14} className="text-green-600" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(p)}><Trash2 size={14} className="text-red-500" /></Button>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {showCreate && (
          <CreateAccountModal
            open={showCreate}
            onClose={() => setShowCreate(false)}
            onCreated={fetchAdmins}
            defaultRole="admin"
          />
        )}

        {editPerms && (
          <PermissionsModal profile={editPerms} onClose={() => setEditPerms(null)} onSaved={() => { setEditPerms(null); fetchAdmins(); }} />
        )}

        <ConfirmDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title="Delete Admin"
          message={`Permanently delete admin "${deleteTarget?.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
        />
      </AdminLayout>
    </RouteGuard>
  );
}



function PermissionsModal({ profile, onClose, onSaved }: { profile: Profile; onClose: () => void; onSaved: () => void }) {
  const [permissions, setPermissions] = useState<string[]>(profile.permissions);
  const [saving, setSaving] = useState(false);

  const togglePerm = (perm: string) => {
    setPermissions((prev) => prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]);
  };

  const handleSave = async () => {
    setSaving(true);
    await supabase.rpc('update_admin_permissions', { p_admin_id: profile.id, p_permissions: permissions });
    setSaving(false);
    onSaved();
  };

  return (
    <Modal open={true} onClose={onClose} title={`Permissions: ${profile.name}`} maxWidth="max-w-md">
      <div className="space-y-4">
        <div>
          <Label>Grant Permissions</Label>
          <div className="space-y-2">
            {PERMISSIONS.map((perm) => (
              <label key={perm} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={permissions.includes(perm)}
                  onChange={() => togglePerm(perm)}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700 dark:text-slate-200 capitalize">{perm.replace(/-/g, ' ').replace('can ', '')}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? <Spinner /> : 'Save Permissions'}</Button>
        </div>
      </div>
    </Modal>
  );
}
