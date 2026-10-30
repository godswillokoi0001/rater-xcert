import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase, callAdminApi } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { Modal, Button, Input, Label, Spinner } from '@/components/ui';
import { PERMISSIONS } from '@/types';
import type { Role } from '@/types';
import { GraduationCap, Briefcase, ShieldCheck, RefreshCw, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';

interface CreateAccountModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  defaultRole?: Role;
}

export function CreateAccountModal({
  open,
  onClose,
  onCreated,
  defaultRole = 'candidate',
}: CreateAccountModalProps) {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const hasAdminPerm = isSuperAdmin || (profile?.permissions || []).includes('can-manage-admins');

  const [role, setRole] = useState<Role>(defaultRole);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<'active' | 'pending'>('active');
  const [permissions, setPermissions] = useState<string[]>([
    'can-manage-tests',
    'can-manage-users',
    'can-view-reports',
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
    let pwd = '';
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(pwd);
    setShowPassword(true);
  };

  const togglePerm = (perm: string) => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password) {
      setError('Please fill in all required fields.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      try {
        await callAdminApi('create-user', 'POST', {
          email: email.trim(),
          password,
          name: name.trim(),
          role,
          status,
          permissions: role === 'admin' ? permissions : [],
        });
      } catch (apiErr) {
        // Fallback: If edge function is not deployed or network error
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const secondaryClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });

        const { data: signUpData, error: signUpErr } = await secondaryClient.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim(), role } },
        });

        if (signUpErr) throw signUpErr;

        if (signUpData.user) {
          const perms = role === 'admin' ? permissions : role === 'worker' ? ['worker'] : [];
          try {
            const { error: updErr } = await supabase
              .from('profiles')
              .update({ role, name: name.trim(), status, permissions: perms })
              .eq('id', signUpData.user.id);
            if (updErr) {
              await supabase
                .from('profiles')
                .update({ name: name.trim(), status, permissions: perms })
                .eq('id', signUpData.user.id);
            }
          } catch {
            await supabase
              .from('profiles')
              .update({ name: name.trim(), status, permissions: perms })
              .eq('id', signUpData.user.id);
          }

          if (role === 'worker') {
            try {
              await supabase.rpc('update_user_role', { p_user_id: signUpData.user.id, p_role: 'worker' });
            } catch {}
          }

          if (status === 'active') {
            await supabase.rpc('update_user_status', { p_user_id: signUpData.user.id, p_status: 'active' });
          }
          if (role === 'admin' && permissions.length > 0) {
            await supabase.rpc('update_admin_permissions', { p_admin_id: signUpData.user.id, p_permissions: permissions });
          }
        }
      }

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create User Account" maxWidth="max-w-lg">
      <form onSubmit={handleSave} className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Role Selection */}
        <div>
          <Label>Select Account Role</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => setRole('candidate')}
              className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                role === 'candidate'
                  ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-semibold shadow-2xs'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center mb-1.5 text-blue-600 dark:text-blue-400">
                <GraduationCap size={18} />
              </div>
              <span className="text-xs">Candidate</span>
            </button>

            <button
              type="button"
              onClick={() => setRole('worker')}
              className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                role === 'worker'
                  ? 'border-purple-600 bg-purple-50/70 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-semibold shadow-2xs'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center mb-1.5 text-purple-600 dark:text-purple-400">
                <Briefcase size={18} />
              </div>
              <span className="text-xs">Worker</span>
            </button>

            {hasAdminPerm && (
              <button
                type="button"
                onClick={() => setRole('admin')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  role === 'admin'
                    ? 'border-amber-600 bg-amber-50/70 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-semibold shadow-2xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center mb-1.5 text-amber-600 dark:text-amber-400">
                  <ShieldCheck size={18} />
                </div>
                <span className="text-xs">Admin</span>
              </button>
            )}

            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setRole('super_admin')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  role === 'super_admin'
                    ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-semibold shadow-2xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center mb-1.5 text-rose-600 dark:text-rose-400">
                  <ShieldCheck size={18} />
                </div>
                <span className="text-xs">Super Admin</span>
              </button>
            )}
          </div>
        </div>

        {/* Full Name */}
        <div>
          <Label>Full Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={role === 'candidate' ? 'Jane Candidate' : role === 'worker' ? 'Alex Staff' : 'Sarah Admin'}
            required
          />
        </div>

        {/* Email Address */}
        <div>
          <Label>Email Address</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            required
          />
        </div>

        {/* Password */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <Label>Password</Label>
            <button
              type="button"
              onClick={generatePassword}
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              <RefreshCw size={12} /> Auto-Generate
            </button>
          </div>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              required
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Initial Status */}
        <div>
          <Label>Account Status</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setStatus('active')}
              className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm transition-all ${
                status === 'active'
                  ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-medium'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              <CheckCircle2 size={16} className={status === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'} />
              <span>Active (Pre-approved)</span>
            </button>

            <button
              type="button"
              onClick={() => setStatus('pending')}
              className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm transition-all ${
                status === 'pending'
                  ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-medium'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              <AlertCircle size={16} className={status === 'pending' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'} />
              <span>Pending Review</span>
            </button>
          </div>
        </div>

        {/* Admin Permissions (Only for Admin role) */}
        {role === 'admin' && (
          <div>
            <Label>Administrative Permissions</Label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {PERMISSIONS.map((perm) => (
                <label
                  key={perm}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={permissions.includes(perm)}
                    onChange={() => togglePerm(perm)}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                    {perm.replace(/-/g, ' ').replace('can ', '')}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner /> : `Create ${role.replace('_', ' ')} Account`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

