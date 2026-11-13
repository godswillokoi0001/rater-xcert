import type { Test } from '../types';

/**
 * Retake policy helpers.
 *
 * Why this module exists:
 * The retake settings used to be written only through `update_test` RPC
 * parameters that the deployed database does not have. Every save therefore
 * failed over to an older RPC signature that silently dropped the retake
 * arguments, so the admin form reverted to "No Retakes" on refresh.
 *
 * Policies are now always mirrored into the test description as metadata tags
 * (the same way `[ROLE:worker]` and `[BLOCKED_USERS:...]` are stored), which
 * makes the setting durable even before the database migration is applied.
 * Once the real columns exist they take part in the same resolution order.
 */

export interface RetakePolicy {
  /** -1 = unlimited, 0 = no retakes, N = that many retakes. */
  retakesAllowed: number;
  /** When true, retakes are only offered after a failed attempt. */
  retakeOnFailOnly: boolean;
}

export const DEFAULT_RETAKE_POLICY: RetakePolicy = {
  retakesAllowed: 0,
  retakeOnFailOnly: true,
};

const RETAKES_TAG_RE = /\[RETAKES:(unlimited|\d+)\]/i;
const RETAKES_TAG_RE_G = /\[RETAKES:(unlimited|\d+)\]/gi;
const RETAKE_MODE_TAG_RE = /\[RETAKE:(FAIL_ONLY|ALWAYS)\]/i;
const RETAKE_MODE_TAG_RE_G = /\[RETAKE:(FAIL_ONLY|ALWAYS)\]/gi;

/** Reads the policy tags written by the admin UI. Returns null when untagged. */
export function parseRetakePolicyTags(description: string = ''): Partial<RetakePolicy> | null {
  const countMatch = RETAKES_TAG_RE.exec(description || '');
  const modeMatch = RETAKE_MODE_TAG_RE.exec(description || '');

  if (!countMatch && !modeMatch) return null;

  const parsed: Partial<RetakePolicy> = {};
  if (countMatch) {
    parsed.retakesAllowed = countMatch[1].toLowerCase() === 'unlimited' ? -1 : Number(countMatch[1]);
  }
  if (modeMatch) {
    parsed.retakeOnFailOnly = modeMatch[1].toUpperCase() === 'FAIL_ONLY';
  }
  return parsed;
}

/** Removes the policy tags so they never leak into candidate-facing copy. */
export function stripRetakePolicyTags(description: string = ''): string {
  return (description || '')
    .replace(RETAKES_TAG_RE_G, '')
    .replace(RETAKE_MODE_TAG_RE_G, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Appends (or replaces) the policy tags on a description. */
export function writeRetakePolicyTags(description: string = '', policy: RetakePolicy): string {
  const safeCount = Number.isFinite(policy.retakesAllowed) ? policy.retakesAllowed : 0;
  const countTag = safeCount === -1 ? '[RETAKES:unlimited]' : `[RETAKES:${safeCount}]`;
  const modeTag = policy.retakeOnFailOnly === false ? '[RETAKE:ALWAYS]' : '[RETAKE:FAIL_ONLY]';

  const clean = stripRetakePolicyTags(description);
  return `${clean} ${countTag} ${modeTag}`.trim();
}

export type TestAudience = 'worker' | 'candidate' | 'all';

const ROLE_WORKER_TAG_RE = /\[ROLE:\s*workers?\]/i;
const ROLE_CANDIDATE_TAG_RE = /\[ROLE:\s*candidates?\]/i;
const ROLE_TAG_RE_G = /\[ROLE:\s*(?:workers?|candidates?)\]/gi;

/** Reads the audience tag written into a test description. */
export function parseRoleTag(description: string = ''): 'worker' | 'candidate' | null {
  if (ROLE_WORKER_TAG_RE.test(description || '')) return 'worker';
  if (ROLE_CANDIDATE_TAG_RE.test(description || '')) return 'candidate';
  return null;
}

/** Removes audience tags so they never reach candidate/worker facing copy. */
export function stripRoleTags(description: string = ''): string {
  return (description || '')
    .replace(ROLE_TAG_RE_G, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Appends (or replaces) the audience tag on a description. */
export function writeRoleTag(description: string = '', audience: TestAudience): string {
  const clean = stripRoleTags(description);
  if (audience !== 'worker' && audience !== 'candidate') return clean;
  return `${clean} ${audience === 'worker' ? '[ROLE:worker]' : '[ROLE:candidate]'}`.trim();
}

/**
 * Resolves which audience a test belongs to.
 *
 * The `target_role` column is authoritative once it is set, but every test also
 * carries a `[ROLE:...]` tag so the audience survives databases/builds that do
 * not know about the column. A worker signal always wins, so a mislabelled test
 * can never leak into the candidate portal.
 */
export function getTestAudience(
  test?: { target_role?: string | null; description?: string | null } | null
): TestAudience {
  const role = (test?.target_role || '').trim().toLowerCase();
  const fromColumn: 'worker' | 'candidate' | null =
    role === 'worker' || role === 'candidate' ? role : null;
  const fromTag = parseRoleTag(test?.description || '');

  if (fromColumn === 'worker' || fromTag === 'worker') return 'worker';
  if (fromColumn === 'candidate' || fromTag === 'candidate') return 'candidate';
  return 'all';
}

type TestPolicySource = Pick<Test, 'retakes_allowed' | 'retake_on_fail_only'> & {
  description?: string | null;
};

/**
 * Resolves the effective retake policy for a test.
 * Order: description tags (always written by the admin UI) > database columns > defaults.
 */
export function getTestRetakePolicy(test?: TestPolicySource | null): RetakePolicy {
  const fromColumns: RetakePolicy = {
    retakesAllowed:
      typeof test?.retakes_allowed === 'number' && Number.isFinite(test.retakes_allowed)
        ? test.retakes_allowed
        : DEFAULT_RETAKE_POLICY.retakesAllowed,
    retakeOnFailOnly:
      typeof test?.retake_on_fail_only === 'boolean'
        ? test.retake_on_fail_only
        : DEFAULT_RETAKE_POLICY.retakeOnFailOnly,
  };

  const fromTags = parseRetakePolicyTags(test?.description || '');
  return fromTags ? { ...fromColumns, ...fromTags } : fromColumns;
}

export interface AttemptForEligibility {
  id?: string;
  review_status?: string | null;
  pass_or_fail?: string | null;
  submitted_at?: string | null;
}

export type RetakeBlockReason = 'locked' | 'unreleased' | 'passed' | 'exhausted';

export interface RetakeEligibility {
  canTake: boolean;
  /** Remaining retakes; 999 is the sentinel the UI already renders as unlimited. */
  retakesRemaining: number;
  hasUnreleasedAttempt: boolean;
  latestOutcome: 'pass' | 'fail' | null;
  blockReason: RetakeBlockReason | null;
  policy: RetakePolicy;
}

function sortNewestFirst(attempts: AttemptForEligibility[]): AttemptForEligibility[] {
  return [...attempts].sort((a, b) => {
    const aTime = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
    const bTime = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
    return bTime - aTime;
  });
}

/**
 * Single source of truth for "can this user start/retake this test?".
 * Used by the candidate dashboard, the worker dashboard and the test runner so
 * the three screens can never disagree again.
 */
export function evaluateRetakeEligibility(
  test: TestPolicySource | undefined,
  attemptsForTest: AttemptForEligibility[],
  manualRetakesRemaining: number = 0
): RetakeEligibility {
  const policy = getTestRetakePolicy(test);
  const sorted = sortNewestFirst(attemptsForTest);
  const hasUnreleasedAttempt = sorted.some(
    (attempt) => attempt.submitted_at && attempt.review_status !== 'released'
  );
  const released = sorted.filter((attempt) => attempt.review_status === 'released');
  const latest = released[0] || null;
  const latestOutcome = latest?.pass_or_fail === 'pass' ? 'pass' : latest?.pass_or_fail === 'fail' ? 'fail' : null;

  if (hasUnreleasedAttempt) {
    return {
      canTake: false,
      retakesRemaining: 0,
      hasUnreleasedAttempt: true,
      latestOutcome,
      blockReason: 'unreleased',
      policy,
    };
  }

  if (released.length === 0) {
    return {
      canTake: true,
      retakesRemaining: 0,
      hasUnreleasedAttempt: false,
      latestOutcome,
      blockReason: null,
      policy,
    };
  }

  const retakesUsed = Math.max(0, released.length - 1);
  const failed = latestOutcome === 'fail';
  const policyAllows =
    policy.retakesAllowed === -1
      ? !policy.retakeOnFailOnly || failed
      : policy.retakesAllowed > 0
        ? retakesUsed < policy.retakesAllowed && (!policy.retakeOnFailOnly || failed)
        : false;

  if (policyAllows) {
    return {
      canTake: true,
      retakesRemaining: policy.retakesAllowed === -1 ? 999 : Math.max(0, policy.retakesAllowed - retakesUsed),
      hasUnreleasedAttempt: false,
      latestOutcome,
      blockReason: null,
      policy,
    };
  }

  if (manualRetakesRemaining > 0) {
    return {
      canTake: true,
      retakesRemaining: manualRetakesRemaining,
      hasUnreleasedAttempt: false,
      latestOutcome,
      blockReason: null,
      policy,
    };
  }

  return {
    canTake: false,
    retakesRemaining: 0,
    hasUnreleasedAttempt: false,
    latestOutcome,
    blockReason: latestOutcome === 'pass' ? 'passed' : 'exhausted',
    policy,
  };
}
