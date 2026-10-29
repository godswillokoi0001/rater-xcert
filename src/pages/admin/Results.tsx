import { useEffect, useState, useCallback } from 'react';
import { supabase, callAdminApi } from '@/lib/supabase';
import { RouteGuard, AdminLayout } from '@/components/layouts';
import { Card, Badge, Spinner, EmptyState, Button, Select } from '@/components/ui';
import { ReviewAttemptModal } from '@/components/ReviewAttemptModal';
import { printAttemptPdf } from '@/lib/printResult';
import type { AttemptWithDetails, Test } from '@/types';
import {
  BarChart3, Download, CheckCircle2, XCircle, TrendingUp, Eye, Clock,
  FileText, RotateCcw, Printer, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search,
} from 'lucide-react';

export function AdminResultsPage() {
  const [attempts, setAttempts] = useState<AttemptWithDetails[]>([]);
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [testFilter, setTestFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [reviewAttemptId, setReviewAttemptId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const [{ data: attemptsData }, { data: testsData }] = await Promise.all([
      supabase.from('attempts').select('*').order('submitted_at', { ascending: false }),
      supabase.from('tests').select('id, title').order('title', { ascending: true }),
    ]);

    const testMap = new Map((testsData || []).map((t) => [t.id, t.title]));

    const candidateIds = [...new Set((attemptsData || []).map((a) => a.candidate_id))];
    const candidateMap = new Map<string, { name: string; email: string }>();
    if (candidateIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, name, email').in('id', candidateIds);
      (profiles || []).forEach((p) => candidateMap.set(p.id, { name: p.name, email: p.email || '' }));
    }

    const enriched: AttemptWithDetails[] = (attemptsData || []).map((a) => ({
      ...a,
      test_title: testMap.get(a.test_id) || 'Unknown',
      candidate_name: candidateMap.get(a.candidate_id)?.name || 'Unknown',
      candidate_email: candidateMap.get(a.candidate_id)?.email || '',
    })) as AttemptWithDetails[];

    setAttempts(enriched);
    setTests((testsData || []) as Test[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filtered = attempts.filter((a) => {
    if (search) {
      const q = search.toLowerCase();
      const matchName = (a.candidate_name || '').toLowerCase().includes(q);
      const matchEmail = (a.candidate_email || '').toLowerCase().includes(q);
      const matchTest = (a.test_title || '').toLowerCase().includes(q);
      if (!matchName && !matchEmail && !matchTest) return false;
    }
    if (testFilter !== 'all' && a.test_id !== testFilter) return false;
    if (resultFilter !== 'all' && a.pass_or_fail !== resultFilter) return false;
    if (reviewFilter !== 'all' && a.review_status !== reviewFilter) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedAttempts = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const grantRetakeToAttempt = async (attempt: AttemptWithDetails) => {
    const count = window.prompt('How many retakes to grant?', '1');
    if (count === null) return;
    const num = Math.max(1, parseInt(count) || 1);
    try {
      await callAdminApi('grant-retake', 'POST', {
        candidateId: attempt.candidate_id,
        testId: attempt.test_id,
        retakeCount: num,
      });
      alert('Retake granted successfully');
      fetchAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to grant retake');
    }
  };

  const handlePrint = async (attemptId: string) => {
    setPrintingId(attemptId);
    try {
      await printAttemptPdf(attemptId);
    } finally {
      setPrintingId(null);
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

  if (loading) {
    return (
      <RouteGuard roles={['admin', 'super_admin']}>
        <AdminLayout current="/admin/results">
          <div className="flex justify-center py-20">
            <Spinner size={32} />
          </div>
        </AdminLayout>
      </RouteGuard>
    );
  }

  const avgScore =
    filtered.length > 0
      ? Math.round((filtered.reduce((s, a) => s + Number(a.score), 0) / filtered.length) * 10) / 10
      : 0;
  const passRate =
    filtered.length > 0
      ? Math.round((filtered.filter((a) => a.pass_or_fail === 'pass').length / filtered.length) * 100)
      : 0;
  const pendingReviewCount = attempts.filter(
    (a) => a.review_status === 'pending_review' || a.review_status === 'reviewed'
  ).length;

  return (
    <RouteGuard roles={['admin', 'super_admin']}>
      <AdminLayout current="/admin/results">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-serif mb-1">
              Results & Reports
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Review candidate and worker attempts, record manual grades, and export official reports
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={exportCSV} disabled={filtered.length === 0}>
              <Download size={16} /> Export CSV
            </Button>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center text-blue-700 dark:text-blue-300">
                <BarChart3 size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{filtered.length}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Total Attempts</p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
                <TrendingUp size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{avgScore}%</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Average Score</p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-900/40 flex items-center justify-center text-green-600 dark:text-green-400">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{passRate}%</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Pass Rate</p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-900/40 flex items-center justify-center text-orange-600 dark:text-orange-400">
                <Clock size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{pendingReviewCount}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Awaiting Review</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Filters and Search */}
        <Card className="p-4 mb-4">
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by candidate, email, or test title..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
              <Select
                value={testFilter}
                onChange={(e) => {
                  setTestFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All Tests</option>
                {tests.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </Select>
              <Select
                value={resultFilter}
                onChange={(e) => {
                  setResultFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All Outcomes</option>
                <option value="pass">Passed</option>
                <option value="fail">Failed</option>
              </Select>
              <Select
                value={reviewFilter}
                onChange={(e) => {
                  setReviewFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All Statuses</option>
                <option value="pending_review">Pending Review</option>
                <option value="reviewed">Reviewed</option>
                <option value="released">Released</option>
              </Select>
            </div>
          </div>
        </Card>

        {/* Results table */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={32} />}
            title="No results match your criteria"
            description="Try adjusting your search queries or filter selections."
          />
        ) : (
          <Card className="overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Candidate / Worker
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Assessment
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Score
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Outcome
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Review Status
                    </th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider hidden sm:table-cell">
                      Date
                    </th>
                    <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {paginatedAttempts.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                          {a.candidate_name || 'Unknown'}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {a.candidate_email || '—'}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-900 dark:text-white">
                        {a.test_title}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-sm font-bold font-mono text-slate-900 dark:text-white">
                          {Number(a.score)}%
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 ml-1">
                          ({a.correct_answers}/{a.total_questions})
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {a.pass_or_fail === 'pass' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                            <CheckCircle2 size={14} /> Pass
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                            <XCircle size={14} /> Fail
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge
                          color={
                            a.review_status === 'released'
                              ? 'green'
                              : a.review_status === 'reviewed'
                              ? 'blue'
                              : 'amber'
                          }
                        >
                          {(a.review_status || 'pending').replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400 hidden sm:table-cell">
                        {a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <Button
                            size="sm"
                            onClick={() => setReviewAttemptId(a.id)}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            <Eye size={14} /> Review & Grade
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handlePrint(a.id)}
                            title="Print PDF Result Document"
                            disabled={printingId === a.id}
                          >
                            {printingId === a.id ? <Spinner size={14} /> : <Printer size={14} />}
                            <span className="hidden lg:inline">Print</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => grantRetakeToAttempt(a)}
                            title="Grant retake"
                          >
                            <RotateCcw size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                <span>
                  Showing {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
                  {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} attempts
                </span>
                <div className="flex items-center gap-1.5">
                  <span>Per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="py-1 px-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 focus:outline-none"
                  >
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPage(1)}
                  disabled={currentPage <= 1}
                  title="First Page"
                  className="px-2"
                >
                  <ChevronsLeft size={16} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  title="Previous Page"
                  className="px-2"
                >
                  <ChevronLeft size={16} />
                </Button>

                <div className="flex items-center gap-1 px-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                    .map((p, idx, arr) => {
                      const prev = arr[idx - 1];
                      const hasGap = prev && p - prev > 1;
                      return (
                        <div key={p} className="flex items-center gap-1">
                          {hasGap && <span className="text-xs text-slate-400 px-1">...</span>}
                          <button
                            onClick={() => setPage(p)}
                            className={`min-w-[28px] h-7 px-2 rounded text-xs font-medium transition-colors ${
                              p === currentPage
                                ? 'bg-blue-600 text-white font-semibold shadow-sm'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
                            }`}
                          >
                            {p}
                          </button>
                        </div>
                      );
                    })}
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  title="Next Page"
                  className="px-2"
                >
                  <ChevronRight size={16} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  title="Last Page"
                  className="px-2"
                >
                  <ChevronsRight size={16} />
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Reusable Review & Manual Grading Modal */}
        <ReviewAttemptModal
          open={!!reviewAttemptId}
          attemptId={reviewAttemptId}
          onClose={() => setReviewAttemptId(null)}
          onUpdated={fetchAll}
        />
      </AdminLayout>
    </RouteGuard>
  );
}
