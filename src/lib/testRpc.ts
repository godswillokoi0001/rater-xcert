import { supabase } from './supabase';
import { writeRetakePolicyTags, writeRoleTag } from './testPolicy';
import type { ReviewMode, TestStatus, TestTargetRole } from '../types';

/**
 * Test persistence helpers.
 *
 * A previous version of the admin screen tried the newest `update_test` RPC
 * signature and fell back to older signatures on *any* error. When the newer
 * signatures were missing from the database, the final fallback silently threw
 * away `retakes_allowed` / `retake_on_fail_only`, so the form "reverted to
 * default" after saving.
 *
 * These helpers:
 *  - always mirror the retake policy into the description tags, so the setting
 *    survives even on an older database;
 *  - only fall back when the failure is a "function does not exist" response;
 *  - surface every other error instead of silently dropping settings.
 */

export interface TestSettingsPayload {
  title: string;
  description: string;
  passMark: number;
  status: TestStatus;
  reviewMode: ReviewMode;
  retakesAllowed: number;
  retakeOnFailOnly: boolean;
  targetRole: TestTargetRole;
}

export interface TestSaveResult {
  error: string | null;
  id?: string;
}

type RpcError = { code?: string; message?: string } | null;

function isMissingFunctionError(error: RpcError): boolean {
  if (!error) return false;
  const code = (error as { code?: string }).code || '';
  const message = (error as { message?: string }).message || '';
  return code === 'PGRST202' || /could not find the function/i.test(message);
}

function clampPassMark(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 70;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function normalizedPolicy(payload: TestSettingsPayload) {
  const retakesAllowed = Number(payload.retakesAllowed);
  return {
    retakesAllowed: Number.isFinite(retakesAllowed) && retakesAllowed >= -1 ? Math.round(retakesAllowed) : 0,
    retakeOnFailOnly: payload.retakeOnFailOnly !== false,
  };
}

function normalizedDescription(payload: TestSettingsPayload): string {
  // The audience is written as a tag as well as a column, so a test can never
  // drift into the wrong portal if one of the two writes is lost.
  const withAudience = writeRoleTag(payload.description || '', normalizedRole(payload));
  return writeRetakePolicyTags(withAudience, normalizedPolicy(payload));
}

function normalizedRole(payload: TestSettingsPayload): TestTargetRole {
  return payload.targetRole === 'worker' || payload.targetRole === 'candidate' ? payload.targetRole : 'all';
}

export async function updateTestRecord(
  payload: TestSettingsPayload & { id: string }
): Promise<TestSaveResult> {
  const description = normalizedDescription(payload);
  const policy = normalizedPolicy(payload);
  const role = normalizedRole(payload);
  const passMark = clampPassMark(payload.passMark);
  const reviewMode = payload.reviewMode === 'immediate' ? 'immediate' : 'super_admin_approval';

  const attempts: Record<string, unknown>[] = [
    {
      p_test_id: payload.id,
      p_title: payload.title,
      p_description: description,
      p_pass_mark: passMark,
      p_status: payload.status,
      p_review_mode: reviewMode,
      p_retakes_allowed: policy.retakesAllowed,
      p_retake_on_fail_only: policy.retakeOnFailOnly,
      p_target_role: role,
    },
    {
      p_test_id: payload.id,
      p_title: payload.title,
      p_description: description,
      p_pass_mark: passMark,
      p_status: payload.status,
      p_review_mode: reviewMode,
      p_retakes_allowed: policy.retakesAllowed,
      p_retake_on_fail_only: policy.retakeOnFailOnly,
    },
    {
      p_test_id: payload.id,
      p_title: payload.title,
      p_description: description,
      p_pass_mark: passMark,
      p_status: payload.status,
      p_review_mode: reviewMode,
    },
  ];

  let lastError: RpcError = null;
  for (const params of attempts) {
    const { error } = await supabase.rpc('update_test', params);
    if (!error) return { error: null };
    lastError = error;
    // Only degrade to an older signature when the signature does not exist.
    if (!isMissingFunctionError(error)) break;
  }

  return { error: (lastError as { message?: string } | null)?.message || 'Failed to update test' };
}

export async function createTestRecord(payload: TestSettingsPayload): Promise<TestSaveResult> {
  const description = normalizedDescription(payload);
  const policy = normalizedPolicy(payload);
  const role = normalizedRole(payload);
  const passMark = clampPassMark(payload.passMark);
  const reviewMode = payload.reviewMode === 'immediate' ? 'immediate' : 'super_admin_approval';

  const attempts: Record<string, unknown>[] = [
    {
      p_title: payload.title,
      p_description: description,
      p_pass_mark: passMark,
      p_review_mode: reviewMode,
      p_retakes_allowed: policy.retakesAllowed,
      p_retake_on_fail_only: policy.retakeOnFailOnly,
      p_target_role: role,
    },
    {
      p_title: payload.title,
      p_description: description,
      p_pass_mark: passMark,
      p_review_mode: reviewMode,
      p_retakes_allowed: policy.retakesAllowed,
      p_retake_on_fail_only: policy.retakeOnFailOnly,
    },
    {
      p_title: payload.title,
      p_description: description,
      p_pass_mark: passMark,
      p_review_mode: reviewMode,
    },
    {
      p_title: payload.title,
      p_description: description,
      p_pass_mark: passMark,
    },
  ];

  let lastError: RpcError = null;
  for (const params of attempts) {
    const { data, error } = await supabase.rpc('create_test', params);
    if (!error) return { error: null, id: (data as string) || undefined };
    lastError = error;
    if (!isMissingFunctionError(error)) break;
  }

  return { error: (lastError as { message?: string } | null)?.message || 'Failed to create test' };
}
