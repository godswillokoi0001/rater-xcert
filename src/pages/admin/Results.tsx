import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { RouteGuard, AdminLayout } from '@/components/layouts';
import { Card, Badge, Spinner, EmptyState, Button, Select } from '@/components/ui';
import type { AttemptWithDetails, Test, QuestionType } from '@/types';
import { BarChart3, Download, CheckCircle2, XCircle, TrendingUp, Eye, Send, Clock, FileText, X, ExternalLink } from 'lucide-react';

interface ReviewData {
  attempt: {
    id: string;
    test_id: string;
    candidate_id: string;
    submitted_at: string;
    score: number;
    pass_or_fail: string;
    correct_answers: number;
    total_questions: number;
    answers: Array<{ question_id: string; selected_option_id: string | null }>;
    review_status: string;
    admin_notes: string;
  };
  test_title: string;
  pass_mark: number;
  candidate_name: string;
  candidate_email: string;
  sections: Array<{ id: string; title: string; order_index: number }>;
  questions: Array<{ id: string; section_id: string; question_image: string; instructions: string; order_index: number; question_type: QuestionType; question_text: string }>;
  options: Array<{ id: string; question_id: string; option_label: string; option_text: string; is_correct: boolean }>;
  links: Array<{ id: string; question_id: string; url: string; label: string; order_index: number }>;
}

export function AdminResultsPage() {
  const [attempts, setAttempts] = useState<AttemptWithDetails[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [testFilter, setTestFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [grantRetake, setGrantRetake] = useState(false);
  const [retakeCount, setRetakeCount] = useState(1);
  const [releasing, setReleasing] = useState(false);
  const [releaseMsg, setReleaseMsg] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [{ data: attemptsData }, { data: testsData }] = await Promise.all([
      supabase.from('attempts').select('*').order('submitted_at', { ascending: false }),
      supabase.from('tests').select('id, title').order('title', { ascending: true }),
    ]);

    const testMap = new Map((testsData || []).map((t) => [t.id, t.title]));

    const candidateIds = [...new Set((attemptsData || []).map((a) => a.candidate_id))];
    let candidateMap = new Map<string, { name: string; email: string }>();
    if (candidateIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', candidateIds);
      (profiles || []).forEach((p) => candidateMap.set(p.id, { name: p.name, email: '' }));
    }

    const enriched: AttemptWithDetails[] = (attemptsData || []).map((a) => ({
      ...a,
      test_title: testMap.get(a.test_id) || 'Unknown',
      candidate_name: candidateMap.get(a.candidate_id)?.name || 'Unknown',
    })) as AttemptWithDetails[];

    setAttempts(enriched);
    setTests((testsData || []) as Test[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = attempts.filter((a) => {
    if (testFilter !== 'all' && a.test_id !== testFilter) return false;
    if (resultFilter !== 'all' && a.pass_or_fail !== resultFilter) return false;
    if (reviewFilter !== 'all' && a.review_status !== reviewFilter) return false;
    return true;
  });

  const openReview = async (attemptId: string) => {
    setReviewLoading(true);
    setReviewData(null);
    setAdminNotes('');
    setGrantRetake(false);
    setRetakeCount(1);
    setReleaseMsg(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) { setReviewLoading(false); return; }

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api/review-attempt?id=${attemptId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load review');
      setReviewData(data);
      setAdminNotes(data.attempt?.admin_notes || '');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setReviewLoading(false);
    }
  };

  const handleRelease = async () => {
    if (!reviewData) return;
    setReleasing(true);
    setReleaseMsg(null);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) { setReleasing(false); return; }

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api/release-attempt`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            attemptId: reviewData.attempt.id,
            adminNotes,
            grantRetake,
            retakeCount: grantRetake ? retakeCount : 0,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to release');

      setReleaseMsg(`Score released successfully! ${data.email_sent ? 'Email sent to ' + data.candidate_email + '.' : 'In-app notification sent.'} ${grantRetake ? 'Retake granted.' : ''}`);
      // Refresh the list
      await fetchAll();
      // Update review data status
      setReviewData({ ...reviewData, attempt: { ...reviewData.attempt, review_status: 'released', admin_notes: adminNotes } });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setReleasing(false);
    }
  };

  const exportCSV = () => {
    const headers = ['Candidate', 'Test', 'Date', 'Status', 'Score (%)', 'Correct', 'Total Questions', 'Result'];
    const rows = filtered.map((a) => [
      a.candidate_name || '',
      a.test_title || '',
      a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : '',
      a.review_status || 'pending_review',
      Number(a.score).toString(),
      a.correct_answers.toString(),
      a.total_questions.toString(),
      a.pass_or_fail,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `raterx-results-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <RouteGuard roles={['admin', 'super_admin']}><AdminLayout current="/admin/results"><div className="flex justify-center py-20"><Spinner size={32} /></div></AdminLayout></RouteGuard>;

  const avgScore = filtered.length > 0 ? Math.round((filtered.reduce((s, a) => s + Number(a.score), 0) / filtered.length) * 10) / 10 : 0;
  const passRate = filtered.length > 0 ? Math.round((filtered.filter((a) => a.pass_or_fail === 'pass').length / filtered.length) * 100) : 0;
  const pendingReviewCount = attempts.filter((a) => a.review_status === 'pending_review' || a.review_status === 'reviewed').length;

  return (
    <RouteGuard roles={['admin', 'super_admin']}>
      <AdminLayout current="/admin/results">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 font-serif mb-1">Results & Reports</h1>
            <p className="text-sm text-slate-500">Review candidate attempts and release scores</p>
          </div>
          <Button variant="secondary" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download size={16} /> Export CSV
          </Button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center text-blue-700"><BarChart3 size={20} /></div>
              <div><p className="text-2xl font-bold text-slate-900">{filtered.length}</p><p className="text-xs text-slate-500">Total Attempts</p></div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600"><TrendingUp size={20} /></div>
              <div><p className="text-2xl font-bold text-slate-900">{avgScore}%</p><p className="text-xs text-slate-500">Average Score</p></div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center text-green-600"><CheckCircle2 size={20} /></div>
              <div><p className="text-2xl font-bold text-slate-900">{passRate}%</p><p className="text-xs text-slate-500">Pass Rate</p></div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600"><Clock size={20} /></div>
              <div><p className="text-2xl font-bold text-slate-900">{pendingReviewCount}</p><p className="text-xs text-slate-500">Awaiting Review</p></div>
            </div>
          </Card>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <Select value={testFilter} onChange={(e) => setTestFilter(e.target.value)}>
                <option value="all">All Tests</option>
                {tests.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </Select>
            </div>
            <div className="flex-1 min-w-[150px]">
              <Select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
                <option value="all">All Results</option>
                <option value="pass">Pass Only</option>
                <option value="fail">Fail Only</option>
              </Select>
            </div>
            <div className="flex-1 min-w-[150px]">
              <Select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}>
                <option value="all">All Statuses</option>
                <option value="pending_review">Pending Review</option>
                <option value="reviewed">Reviewed</option>
                <option value="released">Released</option>
              </Select>
            </div>
          </div>
        </Card>

        {filtered.length === 0 ? (
          <Card><EmptyState icon={<BarChart3 size={28} />} title="No results found" description="No attempts match your filters." /></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Candidate</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Test</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider hidden sm:table-cell">Date</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Score</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Result</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Review Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 text-sm font-medium text-slate-900">{a.candidate_name || 'Unknown'}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-600">{a.test_title || 'Unknown'}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 hidden sm:table-cell">
                        {a.submitted_at ? new Date(a.submitted_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-700">
                        {Number(a.score)}% <span className="text-slate-400">({a.correct_answers}/{a.total_questions})</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {a.pass_or_fail === 'pass' ? (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600"><CheckCircle2 size={16} /> Pass</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600"><XCircle size={16} /> Fail</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {a.review_status === 'pending_review' && (
                          <Badge color="amber"><Clock size={12} className="mr-1" /> Pending</Badge>
                        )}
                        {a.review_status === 'reviewed' && (
                          <Badge color="blue"><Eye size={12} className="mr-1" /> Reviewed</Badge>
                        )}
                        {a.review_status === 'released' && (
                          <Badge color="green"><CheckCircle2 size={12} className="mr-1" /> Released</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {a.review_status !== 'released' ? (
                          <Button size="sm" variant="primary" onClick={() => openReview(a.id)}>
                            <Eye size={14} /> Review
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => openReview(a.id)}>
                            <FileText size={14} /> View
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Review Modal */}
        {(reviewLoading || reviewData) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15, 23, 42, 0.5)' }}>
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              {reviewLoading ? (
                <div className="flex justify-center items-center py-20"><Spinner size={32} /></div>
              ) : reviewData ? (
                <div>
                  {/* Header */}
                  <div className="flex items-center justify-between p-6 border-b border-slate-200 sticky top-0 bg-white z-10">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 font-serif">Review Attempt</h2>
                      <p className="text-sm text-slate-500 mt-1">
                        {reviewData.candidate_name} ({reviewData.candidate_email}) — {reviewData.test_title}
                      </p>
                    </div>
                    <button onClick={() => { setReviewData(null); setReleaseMsg(null); }} className="text-slate-400 hover:text-slate-600 transition-colors">
                      <X size={24} />
                    </button>
                  </div>

                  {/* Score Summary */}
                  <div className="p-6 border-b border-slate-200">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div className="p-4 rounded-xl bg-slate-50 text-center">
                        <p className="text-2xl font-bold text-slate-900">{reviewData.attempt.score}%</p>
                        <p className="text-xs text-slate-500 mt-1">Score</p>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-50 text-center">
                        <p className="text-2xl font-bold text-slate-900">{reviewData.attempt.correct_answers}/{reviewData.attempt.total_questions}</p>
                        <p className="text-xs text-slate-500 mt-1">Correct</p>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-50 text-center">
                        <p className={`text-2xl font-bold ${reviewData.attempt.pass_or_fail === 'pass' ? 'text-green-600' : 'text-red-600'}`}>
                          {reviewData.attempt.pass_or_fail === 'pass' ? 'Pass' : 'Fail'}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">Result</p>
                      </div>
                      <div className="p-4 rounded-xl bg-slate-50 text-center">
                        <p className="text-2xl font-bold text-slate-900">{reviewData.pass_mark}%</p>
                        <p className="text-xs text-slate-500 mt-1">Pass Mark</p>
                      </div>
                    </div>
                  </div>

                  {/* Candidate Answers */}
                  <div className="p-6">
                    <h3 className="font-semibold text-slate-900 mb-4">Candidate Answers</h3>
                    {reviewData.sections.map((section) => {
                      const sectionQuestions = reviewData.questions.filter((q) => q.section_id === section.id);
                      return (
                        <div key={section.id} className="mb-6">
                          <h4 className="text-sm font-semibold text-slate-700 mb-3 pb-2 border-b border-slate-100">{section.title}</h4>
                          {sectionQuestions.map((q, qi) => {
                            const qOptions = reviewData.options.filter((o) => o.question_id === q.id);
                            const candidateAnswer = reviewData.attempt.answers.find((a) => a.question_id === q.id);
                            const isMultiSelect = q.question_type === 'multi_select';
                            const isTextQ = q.question_type === 'text_short' || q.question_type === 'text_long';
                            const selectedOption = qOptions.find((o) => o.id === candidateAnswer?.selected_option_id);
                            const selectedIds = (candidateAnswer as Record<string,unknown>)?.selected_option_ids as string[] | undefined;
                            const textAnswer = (candidateAnswer as Record<string,unknown>)?.text_answer as string | undefined;
                            const isCorrect = isTextQ ? false : isMultiSelect
                              ? (selectedIds || []).length > 0 && (selectedIds || []).every(id => qOptions.find(o => o.id === id)?.is_correct) && (selectedIds || []).length === qOptions.filter(o => o.is_correct).length
                              : selectedOption?.is_correct || false;

                            return (
                              <div key={q.id} className="mb-4 p-4 rounded-lg border border-slate-200">
                                <div className="flex items-start gap-3 mb-3">
                                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center">{qi + 1}</span>
                                  <div className="flex-1">
                                    {q.instructions && <p className="text-sm text-slate-700 mb-2">{q.instructions}</p>}
                                    {q.question_image && (
                                      <img src={q.question_image} alt="Question" className="max-h-40 rounded-lg border border-slate-200 mb-2" />
                                    )}
                                    {(reviewData.links || []).filter((l) => l.question_id === q.id).length > 0 && (
                                      <div className="flex flex-wrap gap-3 mb-2">
                                        {(reviewData.links || []).filter((l) => l.question_id === q.id).map((link) => (
                                          <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                                            <ExternalLink size={12} /> {link.label || link.url}
                                          </a>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  {isTextQ ? (
                                    <span className="flex-shrink-0 text-xs font-medium px-2 py-1 rounded bg-amber-50 text-amber-600">Manual Review</span>
                                  ) : (
                                    <span className={`flex-shrink-0 text-xs font-medium px-2 py-1 rounded ${isCorrect ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                                      {isCorrect ? 'Correct' : 'Incorrect'}
                                    </span>
                                  )}
                                </div>
                                <div className="ml-9 space-y-1.5">
                                  {isTextQ ? (
                                    <div className="px-3 py-2 rounded bg-slate-50 text-sm text-slate-700">
                                      {textAnswer ? textAnswer : <span className="text-slate-400 italic">No answer provided</span>}
                                    </div>
                                  ) : (
                                    <>
                                      {qOptions.map((opt) => {
                                        const isSelected = isMultiSelect
                                          ? (selectedIds || []).includes(opt.id)
                                          : opt.id === candidateAnswer?.selected_option_id;
                                        return (
                                          <div
                                            key={opt.id}
                                            className={`flex items-center gap-2 text-sm px-3 py-2 rounded ${
                                              opt.is_correct ? 'bg-green-50 text-green-700' : isSelected ? 'bg-red-50 text-red-700' : 'text-slate-600'
                                            }`}
                                          >
                                            <span className="font-medium w-6">{opt.option_label}.</span>
                                            <span className="flex-1">{opt.option_text}</span>
                                            {opt.is_correct && <CheckCircle2 size={14} className="text-green-600" />}
                                            {isSelected && !opt.is_correct && <XCircle size={14} className="text-red-600" />}
                                            {isSelected && <span className="text-xs font-medium ml-2">Candidate's choice</span>}
                                          </div>
                                        );
                                      })}
                                      {!candidateAnswer?.selected_option_id && !(selectedIds && selectedIds.length > 0) && (
                                        <p className="text-xs text-slate-400 italic">No answer selected</p>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>

                  {/* Release Controls */}
                  {reviewData.attempt.review_status !== 'released' ? (
                    <div className="p-6 border-t border-slate-200 bg-slate-50">
                      <h3 className="font-semibold text-slate-900 mb-4">Release Score to Candidate</h3>
                      {releaseMsg && (
                        <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700">
                          {releaseMsg}
                        </div>
                      )}
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium text-slate-700 mb-1 block">Admin Notes (optional, visible to candidate)</label>
                          <textarea
                            value={adminNotes}
                            onChange={(e) => setAdminNotes(e.target.value)}
                            rows={3}
                            placeholder="Add any notes for the candidate..."
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={grantRetake}
                              onChange={(e) => setGrantRetake(e.target.checked)}
                              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            Grant retake permission (allows candidate to take this test again)
                          </label>
                          {grantRetake && (
                            <div className="ml-6 flex items-center gap-2">
                              <label className="text-sm text-slate-600">Number of retakes:</label>
                              <input
                                type="number"
                                min={1}
                                max={10}
                                value={retakeCount}
                                onChange={(e) => setRetakeCount(Math.max(1, Number(e.target.value)))}
                                className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          )}
                        </div>
                        <div className="flex justify-end gap-3">
                          <Button variant="secondary" onClick={() => { setReviewData(null); setReleaseMsg(null); }}>
                            Cancel
                          </Button>
                          <Button onClick={handleRelease} disabled={releasing}>
                            {releasing ? <Spinner size={16} /> : <Send size={16} />} Release Score & Notify
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 border-t border-slate-200 bg-green-50">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 size={24} className="text-green-600" />
                        <div>
                          <p className="font-semibold text-green-800">Score Released</p>
                          <p className="text-sm text-green-700">
                            This score has been released to the candidate.
                            {reviewData.attempt.admin_notes && ` Notes: ${reviewData.attempt.admin_notes}`}
                          </p>
                        </div>
                      </div>
                      {releaseMsg && (
                        <div className="mt-3 p-3 rounded-lg bg-green-100 border border-green-200 text-sm text-green-700">
                          {releaseMsg}
                        </div>
                      )}
                      <div className="mt-4 flex justify-end">
                        <Button variant="secondary" onClick={() => { setReviewData(null); setReleaseMsg(null); }}>
                          Close
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </AdminLayout>
    </RouteGuard>
  );
}
