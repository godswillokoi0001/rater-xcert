import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchUserTestAccess, parseAccessTags, cleanTestDescription } from '@/lib/userTestAccess';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { CandidateLayout } from '@/components/layouts';
import { Button, Card, Badge, EmptyState, Spinner } from '@/components/ui';
import type { TestWithCounts, AttemptWithDetails, Notification } from '@/types';
import {
  ClipboardCheck, Clock, Trophy, TrendingUp, Calendar, CheckCircle2, XCircle, Play, Lock, Eye,
  Bell, X, ChevronDown, ChevronUp, MessageSquare, RotateCcw, RefreshCw,
} from 'lucide-react';

export function CandidateDashboard() {
  const { user, profile } = useAuth();
  const [tests, setTests] = useState<TestWithCounts[]>([]);
  const [attempts, setAttempts] = useState<AttemptWithDetails[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [retakeInfo, setRetakeInfo] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [expandedAttempt, setExpandedAttempt] = useState<string | null>(null);

  // If a worker visits /candidate, immediately redirect to /worker
  useEffect(() => {
    if (profile && profile.role === 'worker') {
      navigate('/worker');
    }
  }, [profile]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [
      { data: testsData },
      { data: attemptsData },
      { data: notifData },
      { data: unlocksData },
      accessLookup,
    ] = await Promise.all([
      supabase.from('tests').select('*').eq('status', 'published').order('created_at', { ascending: false }),
      supabase.from('attempts').select('*').eq('candidate_id', user.id).order('submitted_at', { ascending: false }),
      supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
      supabase.from('test_unlocks').select('*').eq('candidate_id', user.id),
      fetchUserTestAccess(user.id),
    ]);

    let attemptsWithTitles: AttemptWithDetails[] = [];
    if (attemptsData && attemptsData.length > 0) {
      const testIds = [...new Set(attemptsData.map((a) => a.test_id))];
      const { data: testInfo } = await supabase.from('tests').select('id, title').in('id', testIds);
      const titleMap = new Map((testInfo || []).map((t) => [t.id, t.title]));
      attemptsWithTitles = (attemptsData || []).map((a) => ({
        ...a,
        test_title: titleMap.get(a.test_id) || 'Unknown Test',
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
    Object.values(accessLookup || {}).forEach((acc) => {
      accessMap[acc.test_id] = acc.access_type;
    });

    // Candidates see tests targeted to 'candidate' or 'all', or granted individually
    const eligibleTests = testsWithCounts.filter((t) => {
      const isWorkerTest = t.target_role === 'worker' || t.description?.includes('[ROLE:worker]');
      if (isWorkerTest) return false;

      // Central database tags check
      const { blockedUsers, grantedUsers } = parseAccessTags(t.description || '');
      const uid = (user.id || '').trim().toLowerCase();
      if (blockedUsers.has(uid)) return false;
      if (grantedUsers.has(uid)) return true;

      const override = accessMap[t.id];
      if (override === 'blocked') return false;
      if (override === 'granted') return true;
      const target = t.target_role || 'all';
      return target === 'all' || target === 'candidate';
    });

    setTests(eligibleTests);
    setAttempts(attemptsWithTitles);
    setNotifications((notifData || []) as Notification[]);
    setRetakeInfo(retakeMap);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const dismissNotification = async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const dismissAllNotifications = async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds);
    setNotifications((prev) => prev.filter((n) => n.read));
  };

  if (loading) return <CandidateLayout><div className="flex justify-center py-20"><Spinner size={32} /></div></CandidateLayout>;

  const releasedAttempts = attempts.filter((a) => a.review_status === 'released');
  const passedCount = releasedAttempts.filter((a) => a.pass_or_fail === 'pass').length;
  const avgScore = releasedAttempts.length > 0
    ? Math.round((releasedAttempts.reduce((sum, a) => sum + Number(a.score), 0) / releasedAttempts.length) * 10) / 10
    : 0;

  const unreadNotifs = notifications.filter((n) => !n.read);

  const getTestStatus = (testId: string): { canTake: boolean; label: string; reason?: string; retakesRemaining?: number } => {
    const test = tests.find((t) => t.id === testId);
    const testAttempts = attempts.filter((a) => a.test_id === testId);
    if (testAttempts.length === 0) return { canTake: true, label: 'Available' };

    const hasUnreleased = testAttempts.some((a) => a.review_status === 'pending_review' || a.review_status === 'reviewed');
    if (hasUnreleased) return { canTake: false, label: 'Awaiting Review', reason: 'Your previous attempt is awaiting admin review.' };

    const releasedAttempts = testAttempts.filter((a) => a.review_status === 'released');
    if (releasedAttempts.length > 0) {
      const latestAttempt = releasedAttempts[0];
      const isFailed = latestAttempt.pass_or_fail === 'fail';

      const testRetakes = test?.retakes_allowed ?? 0;
      const failOnly = test?.retake_on_fail_only ?? true;

      // Check test-level retake policy
      if (testRetakes === -1) {
        if (!failOnly || isFailed) {
          return { canTake: true, label: 'Retake Available', retakesRemaining: 999 };
        }
      } else if (testRetakes > 0) {
        const retakesUsed = Math.max(0, releasedAttempts.length - 1);
        if (retakesUsed < testRetakes && (!failOnly || isFailed)) {
          return { canTake: true, label: 'Retake Available', retakesRemaining: testRetakes - retakesUsed };
        }
      }

      // Check manual admin unlock override
      const manualRemaining = retakeInfo[testId];
      if (manualRemaining && manualRemaining > 0) {
        return { canTake: true, label: 'Retake Available', retakesRemaining: manualRemaining };
      }

      if (latestAttempt.pass_or_fail === 'pass') {
        return { canTake: false, label: 'Passed', reason: 'You have already passed this certification exam.' };
      }
      return { canTake: false, label: 'Retakes Exhausted', reason: 'You have reached the maximum number of retakes for this test.' };
    }

    return { canTake: true, label: 'Available' };
  };

  return (
    <CandidateLayout>
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-serif">
            Candidate Dashboard
          </h1>
          <Badge color="blue" dot>
            Candidate Portal
          </Badge>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          View available certifications, complete exams, and review your accredited results.
        </p>
      </div>

      {/* Notifications */}
      {unreadNotifs.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <Bell size={16} className="text-blue-600 dark:text-blue-400" />
              Notifications
              <span className="ml-1 w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold">{unreadNotifs.length}</span>
            </h2>
            {unreadNotifs.length > 1 && (
              <button onClick={dismissAllNotifications} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium">
                Dismiss all
              </button>
            )}
          </div>
          <div className="space-y-2">
            {unreadNotifs.map((n) => (
              <div key={n.id} className="flex items-start gap-3 p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 animate-slide-in">
                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/60 flex items-center justify-center text-blue-600 dark:text-blue-300 shrink-0 mt-0.5">
                  {n.type === 'result_released' ? <Trophy size={16} /> : <Bell size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{n.title}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{n.message}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                </div>
                <button onClick={() => dismissNotification(n.id)} className="p-1.5 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="p-5 border-l-4 border-l-blue-600">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60">
              <ClipboardCheck size={22} />
            </div>
            <div>
              <p className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">{tests.length}</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Available Assessments</p>
            </div>
          </div>
        </Card>
        <Card className="p-5 border-l-4 border-l-emerald-600">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
              <Trophy size={22} />
            </div>
            <div>
              <p className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">{passedCount}</p>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Tests Passed</p>
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
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Average Score</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Available Tests */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold font-serif text-slate-900 dark:text-white tracking-tight">
            Available Certifications
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Official certification exams available for your candidate profile
          </p>
        </div>
      </div>
      {tests.length === 0 ? (
        <Card className="mb-8">
          <EmptyState
            icon={<ClipboardCheck size={28} />}
            title="No assessments currently available"
            description="All eligible tests will be listed here once released by the evaluation team."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {tests.map((test) => {
            const status = getTestStatus(test.id);
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
                          {cleanTestDescription(test.description)}
                        </p>
                      )}
                    </div>
                    <Badge color={status.canTake ? 'blue' : 'amber'} dot>
                      {test.section_count || 0} {test.section_count === 1 ? 'section' : 'sections'}
                    </Badge>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 mt-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
                    <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
                      <Trophy size={13} className="text-amber-500" /> Pass: {test.pass_mark}%
                    </span>
                    {!status.canTake && (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
                        {status.label === 'Awaiting Review' ? <Clock size={13} /> : <Lock size={13} />}
                        {status.label}
                      </span>
                    )}
                    {status.retakesRemaining !== undefined && status.retakesRemaining > 0 && (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                        <RefreshCw size={13} />{' '}
                        {status.retakesRemaining === 999
                          ? 'Unlimited retakes'
                          : `${status.retakesRemaining} retake${status.retakesRemaining > 1 ? 's' : ''} left`}
                      </span>
                    )}
                  </div>
                  {status.canTake ? (
                    <Button size="sm" onClick={() => navigate(`/candidate/test/${test.id}`)}>
                      {status.retakesRemaining ? (
                        <>
                          <RotateCcw size={14} /> Retake Exam
                        </>
                      ) : (
                        <>
                          <Play size={14} /> Start Exam
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" disabled>
                      <Lock size={14} /> {status.label || 'Unavailable'}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Past Attempts */}
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Past Attempts</h2>
      {attempts.length === 0 ? (
        <Card>
          <EmptyState icon={<Calendar size={28} />} title="No attempts yet" description="Your completed exam results will appear here." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Test</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Score</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Result</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {attempts.map((a) => {
                  const isExpanded = expandedAttempt === a.id;
                  const hasNotes = a.review_status === 'released' && a.admin_notes && a.admin_notes.trim().length > 0;
                  return (
                    <>
                      <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-3.5 text-sm font-medium text-slate-900 dark:text-white">{a.test_title}</td>
                        <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400">
                          {a.submitted_at ? new Date(a.submitted_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '---'}
                        </td>
                        <td className="px-5 py-3.5">
                          {a.review_status === 'pending_review' && (
                            <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-600 dark:text-amber-400"><Clock size={14} /> Awaiting Review</span>
                          )}
                          {a.review_status === 'reviewed' && (
                            <span className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400"><Eye size={14} /> Under Review</span>
                          )}
                          {a.review_status === 'released' && (
                            <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400"><CheckCircle2 size={14} /> Released</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300 font-medium">
                          {a.review_status === 'released' ? (
                            <>{Number(a.score)}% <span className="text-slate-400 dark:text-slate-500 font-normal">({a.correct_answers}/{a.total_questions})</span></>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500 italic">Hidden until released</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {a.review_status === 'released' ? (
                            a.pass_or_fail === 'pass' ? (
                              <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400"><CheckCircle2 size={16} /> Pass</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600 dark:text-red-400"><XCircle size={16} /> Fail</span>
                            )
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500 italic">Pending</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          {hasNotes && (
                            <button onClick={() => setExpandedAttempt(isExpanded ? null : a.id)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && hasNotes && (
                        <tr key={`${a.id}-notes`} className="bg-slate-50/50 dark:bg-slate-800/30">
                          <td colSpan={6} className="px-5 py-3">
                            <div className="flex items-start gap-2 pl-2">
                              <MessageSquare size={14} className="text-slate-400 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Admin Notes</p>
                                <p className="text-sm text-slate-700 dark:text-slate-300">{a.admin_notes}</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {releasedAttempts.length > 1 && (
        <Card className="p-6 mt-6">
          <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-blue-600" /> Score Trend
          </h3>
          <ScoreTrendChart attempts={releasedAttempts} />
        </Card>
      )}
    </CandidateLayout>
  );
}

function ScoreTrendChart({ attempts }: { attempts: AttemptWithDetails[] }) {
  const reversed = [...attempts].reverse();
  const scores = reversed.map((a) => Number(a.score));
  const maxScore = 100;
  const width = 600;
  const height = 160;
  const padding = 30;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  const points = scores.map((s, i) => {
    const x = padding + (scores.length === 1 ? chartW / 2 : (i / (scores.length - 1)) * chartW);
    const y = padding + chartH - (s / maxScore) * chartH;
    return { x, y, score: s };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x} ${padding + chartH} L ${points[0].x} ${padding + chartH} Z`;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 400 }}>
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((v) => {
          const y = padding + chartH - (v / maxScore) * chartH;
          return (
            <g key={v}>
              <line x1={padding} y1={y} x2={width - padding} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padding - 8} y={y + 4} textAnchor="end" className="text-[10px] fill-slate-400">{v}</text>
            </g>
          );
        })}
        <path d={areaD} fill="url(#scoreGrad)" />
        <path d={pathD} fill="none" stroke="#2563eb" strokeWidth="2" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="#2563eb" />
            <text x={p.x} y={p.y - 10} textAnchor="middle" className="text-[10px] fill-slate-600 font-medium">{p.score}%</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
