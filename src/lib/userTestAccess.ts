import { supabase } from './supabase';
import type { UserTestAccess } from '../types';

const STORAGE_KEY = 'raterx_user_test_access_overrides';

function getLocalOverrides(): Record<string, Record<string, { access_type: 'blocked' | 'granted'; created_at: string }>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setLocalOverride(userId: string, testId: string, accessType: 'blocked' | 'granted' | null) {
  try {
    const current = getLocalOverrides();
    if (!current[userId]) current[userId] = {};
    if (accessType === null) {
      delete current[userId][testId];
    } else {
      current[userId][testId] = { access_type: accessType, created_at: new Date().toISOString() };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent('raterx:access_changed', { detail: { userId, testId, accessType } }));
  } catch (err) {
    console.error('Failed to update local access overrides:', err);
  }
}

export async function fetchUserTestAccess(userId: string): Promise<Record<string, UserTestAccess>> {
  const result: Record<string, UserTestAccess> = {};

  // 1. First populate from local overrides (instant & reliable)
  const local = getLocalOverrides()[userId] || {};
  Object.entries(local).forEach(([testId, data]) => {
    result[testId] = {
      id: `local-${testId}`,
      user_id: userId,
      test_id: testId,
      access_type: data.access_type,
      created_at: data.created_at,
    };
  });

  // 2. Query remote user_test_access table if available
  try {
    const { data, error } = await supabase
      .from('user_test_access')
      .select('*')
      .eq('user_id', userId);

    if (!error && data && data.length > 0) {
      data.forEach((item: UserTestAccess) => {
        result[item.test_id] = item;
      });
      return result;
    }
  } catch {
    // Table not created yet on database
  }

  // 3. Fallback: check audit_logs for access overrides
  try {
    const { data: auditData } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('entity_type', 'user_test_access')
      .order('created_at', { ascending: true });

    if (auditData && auditData.length > 0) {
      auditData.forEach((row: { details?: { user_id?: string; test_id?: string; access_type?: string } }) => {
        if (row.details?.user_id === userId && row.details?.test_id) {
          if (row.details.access_type === 'blocked' || row.details.access_type === 'granted') {
            result[row.details.test_id] = {
              id: `audit-${row.details.test_id}`,
              user_id: userId,
              test_id: row.details.test_id,
              access_type: row.details.access_type,
              created_at: new Date().toISOString(),
            };
          } else if (row.details.access_type === 'reset') {
            delete result[row.details.test_id];
          }
        }
      });
    }
  } catch {
    // Non-admin or audit_logs read not permitted
  }

  return result;
}

export async function setUserTestAccessOverride(
  userId: string,
  testId: string,
  accessType: 'blocked' | 'granted'
): Promise<{ success: boolean; error?: string }> {
  // Always update local cache so frontend reflects it immediately
  setLocalOverride(userId, testId, accessType);

  // 1. Try RPC set_user_test_access
  let rpcRes = await supabase.rpc('set_user_test_access', {
    p_user_id: userId,
    p_test_id: testId,
    p_access_type: accessType,
    p_notes: `Admin set to ${accessType}`,
  });

  if (!rpcRes.error) {
    return { success: true };
  }

  // 2. Try direct upsert into user_test_access table
  try {
    const { error: tblErr } = await supabase.from('user_test_access').upsert({
      user_id: userId,
      test_id: testId,
      access_type: accessType,
      notes: `Admin set to ${accessType}`,
    }, { onConflict: 'user_id,test_id' });

    if (!tblErr) {
      return { success: true };
    }
  } catch {
    // Table not created yet
  }

  // 3. Log audit so the change is persisted in the database
  try {
    await supabase.rpc('log_audit', {
      p_action: accessType === 'blocked' ? 'block_user_test' : 'grant_user_test',
      p_entity_type: 'user_test_access',
      p_entity_id: testId,
      p_details: { user_id: userId, test_id: testId, access_type: accessType },
    });
  } catch {
    // Best effort
  }

  return { success: true };
}

export async function removeUserTestAccessOverride(
  userId: string,
  testId: string
): Promise<{ success: boolean; error?: string }> {
  setLocalOverride(userId, testId, null);

  // 1. Try RPC remove_user_test_access
  let rpcRes = await supabase.rpc('remove_user_test_access', {
    p_user_id: userId,
    p_test_id: testId,
  });

  if (!rpcRes.error) {
    return { success: true };
  }

  // 2. Try direct delete
  try {
    const { error: tblErr } = await supabase
      .from('user_test_access')
      .delete()
      .eq('user_id', userId)
      .eq('test_id', testId);

    if (!tblErr) return { success: true };
  } catch {
    // Table not created yet
  }

  // 3. Log audit
  try {
    await supabase.rpc('log_audit', {
      p_action: 'remove_user_test_access',
      p_entity_type: 'user_test_access',
      p_entity_id: testId,
      p_details: { user_id: userId, test_id: testId, access_type: 'reset' },
    });
  } catch {
    // Best effort
  }

  return { success: true };
}
