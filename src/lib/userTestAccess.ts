import { supabase } from './supabase';
import type { UserTestAccess } from '../types';

const STORAGE_KEY = 'raterx_user_test_access_overrides';

export function parseAccessTags(description: string = '') {
  const blockedMatch = description.match(/\[BLOCKED_USERS:([^\]]+)\]/);
  const grantedMatch = description.match(/\[GRANTED_USERS:([^\]]+)\]/);

  const blockedUsers = new Set<string>(
    blockedMatch
      ? blockedMatch[1]
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : []
  );
  const grantedUsers = new Set<string>(
    grantedMatch
      ? grantedMatch[1]
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : []
  );

  return { blockedUsers, grantedUsers };
}

export function updateDescriptionAccessTags(
  description: string = '',
  userId: string,
  action: 'block' | 'grant' | 'reset'
): string {
  const cleanUserId = (userId || '').trim().toLowerCase();
  const { blockedUsers, grantedUsers } = parseAccessTags(description);

  if (action === 'block') {
    blockedUsers.add(cleanUserId);
    grantedUsers.delete(cleanUserId);
  } else if (action === 'grant') {
    grantedUsers.add(cleanUserId);
    blockedUsers.delete(cleanUserId);
  } else if (action === 'reset') {
    blockedUsers.delete(cleanUserId);
    grantedUsers.delete(cleanUserId);
  }

  let clean = description
    .replace(/\[BLOCKED_USERS:[^\]]*\]/g, '')
    .replace(/\[GRANTED_USERS:[^\]]*\]/g, '')
    .trim();

  if (blockedUsers.size > 0) {
    clean = `${clean} [BLOCKED_USERS:${Array.from(blockedUsers).join(',')}]`.trim();
  }
  if (grantedUsers.size > 0) {
    clean = `${clean} [GRANTED_USERS:${Array.from(grantedUsers).join(',')}]`.trim();
  }

  return clean;
}

export function cleanTestDescription(description: string = ''): string {
  return description
    .replace(/\[ROLE:(worker|candidate)\]/g, '')
    .replace(/\[BLOCKED_USERS:[^\]]*\]/g, '')
    .replace(/\[GRANTED_USERS:[^\]]*\]/g, '')
    .trim();
}

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
    const cleanUserId = (userId || '').trim().toLowerCase();
    const current = getLocalOverrides();
    if (!current[cleanUserId]) current[cleanUserId] = {};
    if (accessType === null) {
      delete current[cleanUserId][testId];
    } else {
      current[cleanUserId][testId] = { access_type: accessType, created_at: new Date().toISOString() };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent('raterx:access_changed', { detail: { userId: cleanUserId, testId, accessType } }));
  } catch (err) {
    console.error('Failed to update local access overrides:', err);
  }
}

async function updateTestInDatabase(test: any, newDescription: string) {
  const safeTitle = test.title || 'Untitled Test';
  const safeDesc = newDescription || '';
  const safePassMark = Number(test.pass_mark) || 70;
  const safeStatus = test.status || 'draft';
  const safeReviewMode = test.review_mode || 'super_admin_approval';
  const safeRetakes = test.retakes_allowed ?? 0;
  const safeRetakeFailOnly = test.retake_on_fail_only ?? true;
  const safeTargetRole = test.target_role || 'all';

  // 1. Try 9 params (migration 014)
  let res = await supabase.rpc('update_test', {
    p_test_id: test.id,
    p_title: safeTitle,
    p_description: safeDesc,
    p_pass_mark: safePassMark,
    p_status: safeStatus,
    p_review_mode: safeReviewMode,
    p_retakes_allowed: safeRetakes,
    p_retake_on_fail_only: safeRetakeFailOnly,
    p_target_role: safeTargetRole,
  });

  // 2. Try 8 params (migration 013)
  if (res.error) {
    res = await supabase.rpc('update_test', {
      p_test_id: test.id,
      p_title: safeTitle,
      p_description: safeDesc,
      p_pass_mark: safePassMark,
      p_status: safeStatus,
      p_review_mode: safeReviewMode,
      p_retakes_allowed: safeRetakes,
      p_retake_on_fail_only: safeRetakeFailOnly,
    });
  }

  // 3. Try 6 params (migration 009 - canonical remote DB signature)
  if (res.error) {
    res = await supabase.rpc('update_test', {
      p_test_id: test.id,
      p_title: safeTitle,
      p_description: safeDesc,
      p_pass_mark: safePassMark,
      p_status: safeStatus,
      p_review_mode: safeReviewMode,
    });
  }

  // NEVER call 5 params (to avoid PostgreSQL ambiguous function overload)

  // Also best effort direct update
  try {
    await supabase.from('tests').update({ description: safeDesc }).eq('id', test.id);
  } catch {}

  return res;
}

export async function fetchUserTestAccess(userId: string): Promise<Record<string, UserTestAccess>> {
  const result: Record<string, UserTestAccess> = {};
  const cleanUserId = (userId || '').trim().toLowerCase();

  // 1. First check local overrides
  const local = getLocalOverrides()[cleanUserId] || {};
  Object.entries(local).forEach(([testId, data]) => {
    result[testId] = {
      id: `local-${testId}`,
      user_id: userId,
      test_id: testId,
      access_type: data.access_type,
      created_at: data.created_at,
    };
  });

  // 2. Read from tests table directly (persisted centrally in Supabase DB for all users)
  try {
    const { data: testsData } = await supabase
      .from('tests')
      .select('id, description');

    if (testsData) {
      testsData.forEach((t) => {
        const { blockedUsers, grantedUsers } = parseAccessTags(t.description || '');
        if (blockedUsers.has(cleanUserId)) {
          result[t.id] = {
            id: `desc-${t.id}`,
            user_id: userId,
            test_id: t.id,
            access_type: 'blocked',
            created_at: new Date().toISOString(),
          };
        } else if (grantedUsers.has(cleanUserId)) {
          result[t.id] = {
            id: `desc-${t.id}`,
            user_id: userId,
            test_id: t.id,
            access_type: 'granted',
            created_at: new Date().toISOString(),
          };
        }
      });
    }
  } catch (err) {
    console.error('Error fetching test tags in fetchUserTestAccess:', err);
  }

  // 3. If user_test_access table exists, layer it on top
  try {
    const { data: dbData } = await supabase
      .from('user_test_access')
      .select('*')
      .eq('user_id', userId);

    if (dbData && dbData.length > 0) {
      dbData.forEach((item: UserTestAccess) => {
        result[item.test_id] = item;
      });
    }
  } catch {
    // Table not created yet
  }

  return result;
}

export async function setUserTestAccessOverride(
  userId: string,
  testId: string,
  accessType: 'blocked' | 'granted'
): Promise<{ success: boolean; error?: string }> {
  setLocalOverride(userId, testId, accessType);

  // 1. Fetch test and update its description tags in Postgres centrally
  try {
    const { data: test, error: fetchErr } = await supabase
      .from('tests')
      .select('*')
      .eq('id', testId)
      .maybeSingle();

    if (fetchErr) {
      console.error('Error fetching test in setUserTestAccessOverride:', fetchErr);
    }

    if (test) {
      const newDesc = updateDescriptionAccessTags(
        test.description || '',
        userId,
        accessType === 'blocked' ? 'block' : 'grant'
      );
      const res = await updateTestInDatabase(test, newDesc);
      if (res?.error) {
        console.error('updateTestInDatabase error:', res.error);
        return { success: false, error: res.error.message || 'Failed to update test in database' };
      }
    }
  } catch (err) {
    console.error('Failed to update test description tags:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }

  // 2. Try RPC set_user_test_access (if table/function was added via migration)
  try {
    await supabase.rpc('set_user_test_access', {
      p_user_id: userId,
      p_test_id: testId,
      p_access_type: accessType,
      p_notes: `Admin set to ${accessType}`,
    });
  } catch {}

  // 3. Try direct upsert into user_test_access table
  try {
    await supabase.from('user_test_access').upsert({
      user_id: userId,
      test_id: testId,
      access_type: accessType,
      notes: `Admin set to ${accessType}`,
    }, { onConflict: 'user_id,test_id' });
  } catch {}

  // 4. Log audit so the change is persisted in the database
  try {
    await supabase.rpc('log_audit', {
      p_action: accessType === 'blocked' ? 'block_user_test' : 'grant_user_test',
      p_entity_type: 'user_test_access',
      p_entity_id: testId,
      p_details: { user_id: userId, test_id: testId, access_type: accessType },
    });
  } catch {}

  return { success: true };
}

export async function removeUserTestAccessOverride(
  userId: string,
  testId: string
): Promise<{ success: boolean; error?: string }> {
  setLocalOverride(userId, testId, null);

  // 1. Fetch test and update its description tags in Postgres
  try {
    const { data: test } = await supabase
      .from('tests')
      .select('*')
      .eq('id', testId)
      .maybeSingle();

    if (test) {
      const newDesc = updateDescriptionAccessTags(
        test.description || '',
        userId,
        'reset'
      );
      const res = await updateTestInDatabase(test, newDesc);
      if (res?.error) {
        return { success: false, error: res.error.message || 'Failed to update test in database' };
      }
    }
  } catch (err) {
    console.error('Failed to reset test description tags:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }

  // 2. Try RPC remove_user_test_access
  try {
    await supabase.rpc('remove_user_test_access', {
      p_user_id: userId,
      p_test_id: testId,
    });
  } catch {}

  // 3. Try direct delete
  try {
    await supabase
      .from('user_test_access')
      .delete()
      .eq('user_id', userId)
      .eq('test_id', testId);
  } catch {}

  // 4. Log audit
  try {
    await supabase.rpc('log_audit', {
      p_action: 'remove_user_test_access',
      p_entity_type: 'user_test_access',
      p_entity_id: testId,
      p_details: { user_id: userId, test_id: testId, access_type: 'reset' },
    });
  } catch {}

  return { success: true };
}
