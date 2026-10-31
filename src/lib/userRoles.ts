import { supabase, callAdminApi } from './supabase';

/**
 * Strips internal role markers like [ROLE:worker] or [ROLE:candidate] from user names.
 */
export function cleanUserName(name: string | null | undefined): string {
  if (!name) return '';
  return name.replace(/\s*\[ROLE:\w+\]/gi, '').trim();
}

/**
 * Formats a name with an explicit internal role tag if needed.
 */
export function formatRoleName(name: string | null | undefined, role: 'candidate' | 'worker'): string {
  const clean = cleanUserName(name);
  if (role === 'worker') {
    return clean ? `${clean} [ROLE:worker]` : '[ROLE:worker]';
  }
  return clean;
}

/**
 * Checks whether a given profile belongs to a Worker.
 */
export function isWorkerProfile(
  p: { role?: string; permissions?: string[]; name?: string } | null | undefined
): boolean {
  if (!p) return false;
  if (p.role === 'worker') return true;
  if (Array.isArray(p.permissions) && (p.permissions.includes('worker') || p.permissions.includes('is_worker'))) {
    return true;
  }
  if (typeof p.name === 'string' && p.name.includes('[ROLE:worker]')) {
    return true;
  }
  return false;
}

/**
 * Checks whether a given profile belongs to a Candidate.
 */
export function isCandidateProfile(
  p: { role?: string; permissions?: string[]; name?: string } | null | undefined
): boolean {
  if (!p) return false;
  if (p.role === 'admin' || p.role === 'super_admin') return false;
  return !isWorkerProfile(p);
}

/**
 * Persistently updates a user's role to 'candidate' or 'worker'.
 * Uses the verified SECURITY DEFINER RPC `update_user_name` to store [ROLE:worker] or clean name in the database,
 * and also attempts role column updates via RPC, Edge function, and direct update.
 */
export async function setUserRole(
  userId: string,
  currentName: string | null | undefined,
  targetRole: 'candidate' | 'worker'
): Promise<{ success: boolean; error?: string }> {
  try {
    const updatedName = formatRoleName(currentName, targetRole);

    // 1. Primary persistence: update_user_name RPC (verified SECURITY DEFINER accessible by admins)
    const { error: rpcErr } = await supabase.rpc('update_user_name', {
      p_user_id: userId,
      p_name: updatedName,
    });

    if (rpcErr) {
      console.warn('update_user_name rpc warning:', rpcErr);
      throw new Error(rpcErr.message || 'Failed to update user name tag in database');
    }

    // 2. Best-effort attempts to update role/permissions in database schema
    try {
      await callAdminApi('update-user-role', 'POST', { userId, role: targetRole });
    } catch {
      // Ignored if edge function not deployed
    }

    try {
      await supabase.rpc('update_user_role', { p_user_id: userId, p_role: targetRole });
    } catch {
      // Ignored if RPC not present in remote schema
    }

    try {
      const perms = targetRole === 'worker' ? ['worker'] : [];
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ role: targetRole, name: updatedName, permissions: perms })
        .eq('id', userId);
      if (updErr) {
        await supabase
          .from('profiles')
          .update({ name: updatedName, permissions: perms })
          .eq('id', userId);
      }
    } catch {
      // Ignored
    }

    return { success: true };
  } catch (err) {
    console.error('Failed to set user role:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to update user role',
    };
  }
}
