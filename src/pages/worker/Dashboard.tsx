import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { WorkerLayout } from '@/components/layouts';
import { Button, Card, Badge, EmptyState, Spinner } from '@/components/ui';
import type { TestWithCounts, AttemptWithDetails, Notification } from '@/types';
import {
  Briefcase, Clock, Trophy, TrendingUp, CheckCircle2, XCircle, Play, Lock, Eye,
  Bell, X, ChevronDown, ChevronUp, MessageSquare, RotateCcw, Activity, ShieldCheck,
} from 'lucide-react';

export function WorkerDashboard() {
  const { user, profile } = useAuth();
  const [tests, setTests] = useState<TestWithCounts[]>([]);
  const [attempts, setAttempts] = useState<AttemptWithDetails[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [retakeInfo, setRetakeInfo] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [expandedAttempt, setExpandedAttempt] = useState<string | null>(null);

  // If a candidate accidentally visits /worker, redirect to /candidate
  useEffect(() => {
    if (profile && profile.role === 'candidate') {
      navigate('/candidate');
    }
  }, [profile]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [
      { data: testsData },
      { data: attemptsData },
      { data: notifData },
      { data: unlocksData },
      { data: accessData },
    ] = await Promise.all([
      supabase.from('tests').select('*').eq('status', 'published').order('created_at', { ascending: false }),
      supabase.from('attempts').select('*').eq('candidate_id', user.id).order('submitted_at', { ascending: false }),
      supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('test_unlocks').select('*').eq('candidate_id', user.id),
      supabase.from('user_test_access').select('*').eq('user_id', user.id),
    ]);

    let attemptsWithTitles: AttemptWithDetails[] = [];
    if (attemptsData && attemptsData.length > 0) {
      const testIds = [...new Set(attemptsData.map((a) => a.test_id))];
      const { data: testInfo } = await supabase.from('tests').select('id, title').in('id', testIds);
      const titleMap = new Map((testInfo || []).map((t) => [t.id, t.title]));
      attemptsWithTitles = (attemptsData || []).map((a) => ({
        ...a,
        test_title: titleMap.get(a.test_id) || 'Unknown Task',
      })) as AttemptWithDetails[];
    }

    let testsWithCounts: TestWithCounts[] = [];
    if (testsData && testsData.length > 0) {
      const testIds = testsData.map((t) => t.id);
      const { data: sections } = await supabase.from('sections').select('id, test_id').in('test_id', testIds);
      const sectionCountMap = new Map<string, number>();
      (sections || []).forEach((s) => {
        sectionCountMap.set(s.test_id, (sectionCountMap.get(s.test_id) || 0) + 1);
      });
      testsWithCounts = testsData.map((t) => ({
        ...t,
        section_count: sectionCountMap.get(t.id) || 0,
      })) as TestWithCounts[];
    }

    const retakeMap: Record<string, number> = {};
    (unlocksData || []).forEach((u: { test_id: string; retakes_allowed: number; retakes_used: number }) => {
      const remaining = u.retakes_allowed - u.retakes_used;
      if (remaining > 0) retakeMap[u.test_id] = remaining;
    });

    const accessMap: Record<string, string> = {};
    (accessData || []).forEach((acc: { test_id: string; access_type: string }) => {
      accessMap[acc.test_id] = acc.access_type;
    });

    // Workers see tests strictly targeted to workers, or granted individually
    const eligibleTests = testsWithCounts.filter((t) => {
      const override = accessMap[t.id];
      if (override === 'blocked') return false;
      if (override === 'granted') return true;
      const isWorkerTest = t.target_role === 'worker' || t.description?.includes('[ROLE:worker]');
      return isWorkerTest;
    });

    setTests(eligibleTests);
    setAttempts(attemptsWithTitles);
    setNotifications((notifData || []) as Notification[]);
    setRetakeInfo(retakeMap);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const dismissNotification = async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const dismissAllNotifications = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id);
    setNotifications([]);
  };

  if (loading) {
    return (
      <WorkerLayout>
        <div className="flex justify-center py-20">
          <Spinner size={32} />
        </div>
      </WorkerLayout>
    );
  }

  const passedCount = attempts.filter((a) => a.pass_or_fail === 'pass').length;
  const avgScore = attempts.length > 0
    ? Math.round((attempts.reduce((s, a) => s + Number(a.score), 0) / attempts.length) * 10) / 10
    : 0;
  const unreadNotifs = notifications.filter((n) => !n.read);

  const getTaskStatus = (testId: string) => {
    const testAttempts = attempts.filter((a) => a.test_id === testId);
    const test = tests.find((t) => t.id === testId);

    if (testAttempts.length === 0) return { canTake: true, label: 'Available' };

    const hasUnreleased = testAttempts.some((a) => a.review_status !== 'released');
    if (hasUnreleased) return { canTake: false, label: 'In Verification', reason: 'Your submitted task evaluation is awaiting operational review.' };

    const releasedAttempts = testAttempts.filter((a) => a.review_status === 'released');
    if (releasedAttempts.length > 0) {
      const latestAttempt = releasedAttempts[0];
      const isFailed = latestAttempt.pass_or_fail === 'fail';

      const testRetakes = test?.retakes_allowed ?? 0;
      const failOnly = test?.retake_on_fail_only ?? true;

      if (testRetakes === -1) {
        if (!failOnly || isFailed) return { canTake: true, label: 'Re-evaluation Available', retakesRemaining: 999 };
      } else if (testRetakes > 0) {
        const retakesUsed = Math.max(0, releasedAttempts.length - 1);
        if (retakesUsed < testRetakes && (!failOnly || isFailed)) {
          return { canTake: true, label: 'Re-evaluation Available', retakesRemaining: testRetakes - retakesUsed };
        }
      }

      const manualRemaining = retakeInfo[testId];
      if (manualRemaining && manualRemaining > 0) {
        return { canTake: true, label: 'Re-evaluation Available', retakesRemaining: manualRemaining };
      }

      if (latestAttempt.pass_or_fail === 'pass') {
        return { canTake: false, label: 'Completed', reason: 'You have already met the required standard for this evaluation.' };
      }
      return { canTake: false, label: 'Max Attempts Reached', reason: 'You have reached the maximum number of attempts allocated for this task.' };
    }

    return { canTake: true, label: 'Available' };
  };

  return (
    <WorkerLayout>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2.5 mb-1.5">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-serif tracking-tight">
            Worker Operations Hub
          </h1>
          <Badge color="purple" dot>
            Verified Worker
          </Badge>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage your allocated tasks, complete operational evaluations, and view your performance track record.
        </p>
      </div>

      {/* Notifications */}
      {unreadNotifs.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Bell size={16} className="text-purple-600 dark:text-purple-400" />
              Operational Updates
              <span className="ml-1 w-5 h-5 rounded-full bg-purple-600 text-white text-xs flex items-center justify-center font-bold">
                {unreadNotifs.length}
              </span>
            </h2>
            {unreadNotifs.length > 1 && (
              <button
                onClick={dismissAllNotifications}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium"
              >
                Dismiss all
              </button>
            )}
          </div>
          <div className="space-y-2">
            {unreadNotifs.map((n) => (
              <div
                key={n.id}
                className="flex items-start gap-3 p-4 rounded-xl bg-purple-50/70 dark:bg-purple-950/40 border border-purple-100 dark:border-purple-900 animate-slide-in"
              >
                <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/60 flex items-center justify-center text-purple-600 dark:text-purple-300 shrink-0 mt-0.5">
                  {n.type === 'result_released' ? <Trophy size={16} /> : <Bell size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{n.title}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{n.message}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    {new Date(n.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <button
                  onClick={() => dismissNotification(n.id)}
                  className="p-1.5 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/60 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Worker Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        <Card className="p-5 border-l-4 border-l-purple-600">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-purple-50 dark:bg-purple-950/60 flex items-center justify-center text-purple-600 dark:text-purple-400 border border-purple-200/60 dark:border-purple-800/60">
              <Briefcase size={22} />
            </div>
            <div>
              <p className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">{tests.length}</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Assigned Tasks</p>
            </div>
          </div>
        </Card>

        <Card className="p-5 border-l-4 border-l-emerald-600">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <p className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">{passedCount}</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Completed</p>
            </div>
          </div>
        </Card>

        <Card className="p-5 border-l-4 border-l-amber-500">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/60 flex items-center justify-center text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60">
              <TrendingUp size={22} />
            </div>
            <div>
              <p className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">{avgScore}%</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Accuracy Rating</p>
            </div>
          </div>
        </Card>

        <Card className="p-5 border-l-4 border-l-blue-600">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60">
              <Activity size={22} />
            </div>
            <div>
              <p className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Active</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Worker Standing</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Available Worker Tasks */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold font-serif text-slate-900 dark:text-white tracking-tight">
            Assigned Work Tasks & Evaluations
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Work packages and verification evaluations currently active for your worker profile
          </p>
        </div>
      </div>

      {tests.length === 0 ? (
        <Card className="mb-8">
          <EmptyState
            icon={<Briefcase size={28} className="text-purple-600" />}
            title="No worker tasks currently queued"
            description="New operational evaluations will appear here once allocated by your administrator."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {tests.map((test) => {
            const status = getTaskStatus(test.id);
            return (
              <Card key={test.id} className="p-5 hover:shadow-md transition-all flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="flex-1">
                      <h3 className="font-bold text-base text-slate-900 dark:text-white mb-1 tracking-tight leading-snug">
                        {test.title}
                      </h3>
                      {test.description && (
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                          {test.description.replace(/\[ROLE:(worker|candidate)\]/g, '').trim()}
                        </p>
                      )}
                    </div>
                    <Badge color={status.canTake ? 'purple' : 'amber'} dot>
                      {test.section_count || 0} {test.section_count === 1 ? 'section' : 'sections'}
                    </Badge>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 mt-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                    <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                      <Trophy size={13} className="text-amber-500" /> Target: {test.pass_mark}%
                    </span>
                    {!status.canTake && (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                        {status.label === 'In Verification' ? <Clock size={13} /> : <Lock size={13} />}
                        {status.label}
                      </span>
                    )}
                    {status.canTake && status.retakesRemaining && status.retakesRemaining < 999 && (
                      <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                        <RotateCcw size={12} /> {status.retakesRemaining} re-evaluation{status.retakesRemaining > 1 ? 's' : ''} left
                      </span>
                    )}
                  </div>

                  <div>
                    {status.canTake && (
                      <Button size="sm" className="bg-purple-700 hover:bg-purple-600 text-white" onClick={() => navigate(`/worker/test/${test.id}`)}>
                        <Play size={14} /> Begin Task
                      </Button>
                    )}
                    {!status.canTake && status.reason && (
                      <span className="text-xs text-slate-400 italic block">{status.reason}</span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Completed Work History */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold font-serif text-slate-900 dark:text-white tracking-tight">
            Completed Task Submissions & Evaluations
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Audit history of your completed operational tasks and verified scores
          </p>
        </div>
      </div>

      {attempts.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Clock size={28} className="text-purple-600" />}
            title="No task submissions yet"
            description="Completed tasks and verification ratings will be recorded here."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Task Title</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider hidden sm:table-cell">Submitted</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Score</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Result</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Verification</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {attempts.map((attempt) => {
                  const isReleased = attempt.review_status === 'released';
                  const isExpanded = expandedAttempt === attempt.id;

                  return (
                    <tr key={attempt.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-5 py-3.5 text-sm font-semibold text-slate-900 dark:text-white">
                        {attempt.test_title}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400 hidden sm:table-cell">
                        {new Date(attempt.submitted_at).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-5 py-3.5 text-sm font-bold text-slate-900 dark:text-white">
                        {isReleased ? `${attempt.score}%` : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        {isReleased ? (
                          attempt.pass_or_fail === 'pass' ? (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 size={15} /> Standard Met
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-rose-600 dark:text-rose-400">
                              <XCircle size={15} /> Standard Not Met
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-slate-400 font-medium">Under Review</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {attempt.review_status === 'pending_review' && (
                          <Badge color="amber"><Clock size={11} className="mr-1" /> Pending</Badge>
                        )}
                        {attempt.review_status === 'reviewed' && (
                          <Badge color="blue"><Eye size={11} className="mr-1" /> In Review</Badge>
                        )}
                        {attempt.review_status === 'released' && (
                          <Badge color="purple"><CheckCircle2 size={11} className="mr-1" /> Verified</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => setExpandedAttempt(isExpanded ? null : attempt.id)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700"
                        >
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                          <span>{isExpanded ? 'Hide' : 'View'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </WorkerLayout>
  );
}

