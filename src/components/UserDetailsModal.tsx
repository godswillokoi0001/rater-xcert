import { useState, useEffect, useCallback } from 'react';
import { supabase, callAdminApi } from '@/lib/supabase';
import {
  fetchUserTestAccess,
  setUserTestAccessOverride,
  removeUserTestAccessOverride,
  parseAccessTags,
  updateDescriptionAccessTags,
  cleanTestDescription,
} from '@/lib/userTestAccess';
import { Modal, Badge, Button, Spinner, EmptyState } from '@/components/ui';
import { ReviewAttemptModal } from '@/components/ReviewAttemptModal';
import { printAttemptPdf } from '@/lib/printResult';
import type { Profile, Test, AttemptWithDetails, UserTestAccess } from '@/types';
import {
  FileText, Award, CheckCircle2, XCircle, Clock, ShieldAlert,
  Unlock, Lock, RotateCcw, Eye, Users, Briefcase, Calendar, Mail, Check, GraduationCap, Printer, Archive
} from 'lucide-react';

interface UserDetailsModalProps {
  user: Profile;
  onClose: () => void;
  onUserUpdated?: () => void;
}

export function UserDetailsModal({ user, onClose, onUserUpdated }: UserDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'tests' | 'access'>('tests');
  const [loading, setLoading] = useState(true);
  const [currentRole, setCurrentRole] = useState(user.role);
  const [switchingRole, setSwitchingRole] = useState(false);
  const [attempts, setAttempts] = useState<AttemptWithDetails[]>([]);
  const [allTests, setAllTests] = useState<Test[]>([]);
  const [testAccessMap, setTestAccessMap] = useState<Record<string, UserTestAccess>>({});
  const [updatingTestId, setUpdatingTestId] = useState<string | null>(null);
  const [selectedAttemptIdForReview, setSelectedAttemptIdForReview] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const loadUserData = useCallback(async () => {
    setLoading(true);
    try {
      const [
        { data: attemptsData },
        { data: testsData },
        accessLookup,
      ] = await Promise.all([
        supabase
          .from('attempts')
          .select('*')
          .eq('candidate_id', user.id)
          .order('submitted_at', { ascending: false }),
        supabase
          .from('tests')
          .select('*')
          .order('title', { ascending: true }),
        fetchUserTestAccess(user.id),
      ]);

      const testTitleMap = new Map((testsData || []).map((t) => [t.id, t.title]));
      const enrichedAttempts: AttemptWithDetails[] = (attemptsData || []).map((a) => ({
        ...a,
        test_title: testTitleMap.get(a.test_id) || 'Unknown Test',
        candidate_name: user.name,
        candidate_email: user.email,
      }));

      // Merge direct access tags from all tests into accessLookup
      const uid = (user.id || '').trim().toLowerCase();
      (testsData || []).forEach((t) => {
        const { blockedUsers, grantedUsers } = parseAccessTags(t.description || '');
        if (blockedUsers.has(uid)) {
          accessLookup[t.id] = {
            id: `tag-${t.id}`,
            user_id: user.id,
            test_id: t.id,
            access_type: 'blocked',
            created_at: new Date().toISOString(),
          };
        } else if (grantedUsers.has(uid)) {
          accessLookup[t.id] = {
            id: `tag-${t.id}`,
            user_id: user.id,
            test_id: t.id,
            access_type: 'granted',
            created_at: new Date().toISOString(),
          };
        }
      });

      setAttempts(enrichedAttempts);
      setAllTests((testsData || []) as Test[]);
      setTestAccessMap(accessLookup);
    } catch (err) {
      console.error('Error loading user details:', err);
    } finally {
      setLoading(false);
    }
  }, [user.id, user.name, user.email]);

  useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  // Set individual test access override (block or release)
  const handleSetAccess = async (testId: string, accessType: 'blocked' | 'granted') => {
    setUpdatingTestId(testId);
    try {
      const result = await setUserTestAccessOverride(user.id, testId, accessType);
      if (!result.success) {
        throw new Error(result.error || 'Failed to update access');
      }

      setTestAccessMap((prev) => ({
        ...prev,
        [testId]: {
          id: prev[testId]?.id || `temp-${Date.now()}`,
          user_id: user.id,
          test_id: testId,
          access_type: accessType,
          created_at: new Date().toISOString(),
        },
      }));

      setAllTests((prev) =>
        prev.map((t) => {
          if (t.id !== testId) return t;
          return {
            ...t,
            description: updateDescriptionAccessTags(
              t.description || '',
              user.id,
              accessType === 'blocked' ? 'block' : 'grant'
            ),
          };
        })
      );

      showToast(accessType === 'blocked' ? 'Test access blocked' : 'Test released to user');
      onUserUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update access');
    } finally {
      setUpdatingTestId(null);
    }
  };

  // Remove individual test access override (reset to default)
  const handleRemoveAccess = async (testId: string) => {
    setUpdatingTestId(testId);
    try {
      const result = await removeUserTestAccessOverride(user.id, testId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to reset access');
      }

      setTestAccessMap((prev) => {
        const next = { ...prev };
        delete next[testId];
        return next;
      });

      setAllTests((prev) =>
        prev.map((t) => {
          if (t.id !== testId) return t;
          return {
            ...t,
            description: updateDescriptionAccessTags(t.description || '', user.id, 'reset'),
          };
        })
      );

      showToast('Reset to default role policy');
      onUserUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reset access');
    } finally {
      setUpdatingTestId(null);
    }
  };

  // Calculate effective availability for a test
  const getTestStatus = (test: Test) => {
    // 1. If the test is archived, it must show as archived, not available/blockable
    if (test.status === 'archived') {
      return {
        status: 'archived',
        label: 'Archived',
        desc: 'This test is archived and not available to candidates or workers.',
        badgeColor: 'slate' as const,
      };
    }

    // 2. If the test is in draft mode
    if (test.status === 'draft') {
      return {
        status: 'draft',
        label: 'Draft',
        desc: 'This test is currently unpublished.',
        badgeColor: 'amber' as const,
      };
    }

    // 3. Explicit individual user access overrides (block or release)
    const override = testAccessMap[test.id];
    if (override) {
      if (override.access_type === 'blocked') {
        return {
          status: 'blocked',
          label: 'Blocked by Admin',
          desc: 'User cannot see or take this test.',
          badgeColor: 'red' as const,
        };
      }
      if (override.access_type === 'granted') {
        return {
          status: 'granted',
          label: 'Released to User',
          desc: 'Explicitly granted access by administrator.',
          badgeColor: 'blue' as const,
        };
      }
    }

    const isWorkerUser = currentRole === 'worker' || (user.permissions || []).includes('worker');
    const effectiveUserRole = isWorkerUser ? 'worker' : 'candidate';

    const isWorkerTest = test.target_role === 'worker' || test.description?.includes('[ROLE:worker]');
    const isCandidateTest = test.target_role === 'candidate' || test.description?.includes('[ROLE:candidate]');
    const testTarget = isWorkerTest ? 'worker' : isCandidateTest ? 'candidate' : (test.target_role || 'all');

    if (testTarget === 'all' || testTarget === effectiveUserRole) {
      return {
        status: 'default_available',
        label: 'Available (Default)',
        desc: `Available to all ${testTarget === 'all' ? 'users' : effectiveUserRole + 's'}.`,
        badgeColor: 'green' as const,
      };
    }

    return {
      status: 'default_ineligible',
      label: 'Role Ineligible',
      desc: `Restricted to ${testTarget === 'worker' ? 'Workers' : 'Candidates'}.`,
      badgeColor: 'slate' as const,
    };
  };

  const isWorker = currentRole === 'worker' || (user.permissions || []).includes('worker');

  const handleSwitchRole = async () => {
    const nextRole = isWorker ? 'candidate' : 'worker';
    setSwitchingRole(true);
    try {
      try {
        await callAdminApi('update-user-role', 'POST', { userId: user.id, role: nextRole });
      } catch {
        await supabase.rpc('update_user_role', { p_user_id: user.id, p_role: nextRole });
      }
      const newPerms = nextRole === 'worker'
        ? Array.from(new Set([...(user.permissions || []), 'worker']))
        : (user.permissions || []).filter((p) => p !== 'worker' && p !== 'is_worker');
      user.role = nextRole;
      user.permissions = newPerms;
      const { error: err } = await supabase.from('profiles').update({ role: nextRole, permissions: newPerms }).eq('id', user.id);
      if (err) {
        await supabase.from('profiles').update({ permissions: newPerms }).eq('id', user.id);
      }
      setCurrentRole(nextRole);
      showToast(`User successfully changed to ${nextRole === 'worker' ? 'Worker' : 'Candidate'}.`);
      onUserUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update user role');
    } finally {
      setSwitchingRole(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="User Details & Test Management" maxWidth="max-w-4xl">
      <div className="space-y-6">
        {/* User Profile Header Card */}
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-slate-50 to-blue-50/40 dark:from-slate-800/80 dark:to-blue-950/20 border border-slate-200 dark:border-slate-700">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold ${
                  isWorker
                    ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
                    : 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300'
                }`}
              >
                {isWorker ? <Briefcase size={22} /> : <Users size={22} />}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{user.name || 'Unnamed User'}</h3>
                  <Badge color={isWorker ? 'purple' : 'blue'}>
                    {isWorker ? 'Worker' : 'Candidate'}
                  </Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={switchingRole}
                    onClick={handleSwitchRole}
                    title={`Switch role to ${isWorker ? 'Candidate' : 'Worker'}`}
                    className="text-xs h-7 px-2.5"
                  >
                    {switchingRole ? (
                      <Spinner size={12} />
                    ) : isWorker ? (
                      <>
                        <GraduationCap size={13} /> Switch to Candidate
                      </>
                    ) : (
                      <>
                        <Briefcase size={13} /> Switch to Worker
                      </>
                    )}
                  </Button>
                  <Badge color={user.status === 'active' ? 'green' : user.status === 'pending' ? 'amber' : 'red'}>
                    {user.status}
                  </Badge>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                  <Mail size={13} /> {user.email || 'No email registered'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
              <div className="text-left sm:text-right">
                <p className="flex items-center gap-1">
                  <Calendar size={12} /> Joined: {new Date(user.created_at).toLocaleDateString()}
                </p>
                <p className="mt-0.5">
                  Last Login: {user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Toast Alert */}
        {toastMsg && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs sm:text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2 animate-fade-in">
            <Check size={16} />
            <span>{toastMsg}</span>
          </div>
        )}

        {/* Tab Selector */}
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('tests')}
            className={`flex items-center gap-2 py-2 px-4 rounded-xl text-sm font-semibold transition-all ${
              activeTab === 'tests'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Award size={16} />
            <span>Tests Written ({attempts.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('access')}
            className={`flex items-center gap-2 py-2 px-4 rounded-xl text-sm font-semibold transition-all ${
              activeTab === 'access'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Lock size={16} />
            <span>Test Availability & Controls ({allTests.length})</span>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center py-16">
            <Spinner size={32} />
          </div>
        ) : activeTab === 'tests' ? (
          /* Tab 1: Tests Written / Attempt History */
          <div className="space-y-3">
            {attempts.length === 0 ? (
              <EmptyState
                icon={<Award size={32} />}
                title="No tests written yet"
                description={`This ${isWorker ? 'worker' : 'candidate'} has not attempted or submitted any assessments so far.`}
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                {attempts.map((att) => (
                  <div
                    key={att.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 dark:text-white text-sm">
                          {att.test_title}
                        </p>
                        {att.pass_or_fail === 'pass' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                            <CheckCircle2 size={13} /> Pass
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                            <XCircle size={13} /> Fail
                          </span>
                        )}
                        <Badge color={att.review_status === 'released' ? 'green' : 'amber'}>
                          {att.review_status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Submitted: {att.submitted_at ? new Date(att.submitted_at).toLocaleString() : 'In Progress'} • Score:{' '}
                        <strong className="text-slate-700 dark:text-slate-300">{Number(att.score)}%</strong> ({att.correct_answers}/{att.total_questions} correct)
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
                      {att.review_status === 'pending_review' ? (
                        <Button
                          size="sm"
                          onClick={() => setSelectedAttemptIdForReview(att.id)}
                          className="bg-amber-600 hover:bg-amber-700 text-white font-medium"
                          title="Awaiting examiner review and manual grading"
                        >
                          <Clock size={14} /> Review & Grade
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setSelectedAttemptIdForReview(att.id)}
                          title="View assessment result details"
                        >
                          <FileText size={14} /> View Result
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => printAttemptPdf(att.id)}
                        title="Print accredited result report PDF"
                      >
                        <Printer size={14} /> Print PDF
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Tab 2: Test Availability & Controls */
          <div className="space-y-3">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 text-xs sm:text-sm text-slate-600 dark:text-slate-300 flex items-start gap-2.5">
              <ShieldAlert size={18} className="shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Test Access & Visibility Policy</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Control which assessments this user sees on their dashboard. You can block them from tests they normally see, or explicitly release tests to them.
                </p>
              </div>
            </div>

            {allTests.length === 0 ? (
              <EmptyState
                icon={<FileText size={32} />}
                title="No published tests"
                description="Publish tests in the Tests tab to configure user access."
              />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
                {allTests.map((t) => {
                  const state = getTestStatus(t);
                  const isUpdating = updatingTestId === t.id;
                  const isOverridden = !!testAccessMap[t.id];

                  return (
                    <div
                      key={t.id}
                      className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900 dark:text-white text-sm">{t.title}</p>
                          <Badge color={state.badgeColor}>{state.label}</Badge>
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            Target: {t.target_role === 'worker' ? 'Workers' : t.target_role === 'candidate' ? 'Candidates' : 'All'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {cleanTestDescription(t.description) ? `${cleanTestDescription(t.description)} • ` : ''}{state.desc} • Pass Mark: {t.pass_mark}%
                        </p>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 flex-wrap self-start md:self-center">
                        {state.status === 'archived' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            <Archive size={13} /> Archived
                          </span>
                        ) : state.status === 'draft' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                            Draft (Unpublished)
                          </span>
                        ) : state.status === 'blocked' ? (
                          <>
                            <Button
                              size="sm"
                              variant="success"
                              disabled={isUpdating}
                              onClick={() => handleSetAccess(t.id, 'granted')}
                              title="Release / Grant this test to user"
                            >
                              <Unlock size={14} /> Release Test
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={isUpdating}
                              onClick={() => handleRemoveAccess(t.id)}
                              title="Reset to default role policy"
                            >
                              <RotateCcw size={14} /> Reset
                            </Button>
                          </>
                        ) : state.status === 'granted' ? (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={isUpdating}
                              onClick={() => handleSetAccess(t.id, 'blocked')}
                              title="Block user from taking this test"
                              className="text-red-600 dark:text-red-400 hover:text-red-700"
                            >
                              <Lock size={14} /> Block Test
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={isUpdating}
                              onClick={() => handleRemoveAccess(t.id)}
                              title="Reset to default role policy"
                            >
                              <RotateCcw size={14} /> Reset
                            </Button>
                          </>
                        ) : state.status === 'default_available' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isUpdating}
                            onClick={() => handleSetAccess(t.id, 'blocked')}
                            title="Block user from seeing or taking this test"
                            className="text-amber-700 dark:text-amber-400"
                          >
                            <Lock size={14} /> Block Test
                          </Button>
                        ) : (
                          /* default_ineligible */
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={isUpdating}
                            onClick={() => handleSetAccess(t.id, 'granted')}
                            title="Release this test specifically to this user"
                          >
                            <Unlock size={14} /> Release to User
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <ReviewAttemptModal
        open={!!selectedAttemptIdForReview}
        attemptId={selectedAttemptIdForReview}
        onClose={() => setSelectedAttemptIdForReview(null)}
        onUpdated={loadUserData}
      />
    </Modal>
  );
}

