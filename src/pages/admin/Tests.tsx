import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { RouteGuard, AdminLayout } from '@/components/layouts';
import { Button, Card, Badge, Input, Textarea, Label, Modal, Spinner, EmptyState, ConfirmDialog, Select } from '@/components/ui';
import type { Test, Section, Question, Option, QuestionLink, TestStatus, ReviewMode, QuestionType, ScoringMode } from '@/types';
import { ShieldCheck, Zap, RotateCcw, Users, Briefcase, GraduationCap } from 'lucide-react';
import {
  Plus, FileText, ChevronDown, ChevronRight, Trash2, Edit3, GripVertical,
  Upload, ExternalLink, Check, X, Eye, Archive, Send, Image as ImageIcon,
  List, CheckSquare, Type, AlignLeft, ChevronDownSquare, ToggleLeft,
} from 'lucide-react';

function normalizeExternalUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/\//, '')}`;
  const url = new URL(candidate);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('External links must use http:// or https://');
  }

  return url.href;
}

const QUESTION_TYPE_META: Record<QuestionType, { label: string; icon: React.ReactNode; color: string }> = {
  single_choice: { label: 'Single Choice', icon: <List size={14} />, color: 'text-blue-600 bg-blue-50' },
  multi_select: { label: 'Multi-Select', icon: <CheckSquare size={14} />, color: 'text-teal-600 bg-teal-50' },
  text_short: { label: 'Short Answer', icon: <Type size={14} />, color: 'text-amber-600 bg-amber-50' },
  text_long: { label: 'Long Answer', icon: <AlignLeft size={14} />, color: 'text-orange-600 bg-orange-50' },
  dropdown: { label: 'Dropdown', icon: <ChevronDownSquare size={14} />, color: 'text-indigo-600 bg-indigo-50' },
  true_false: { label: 'True / False', icon: <ToggleLeft size={14} />, color: 'text-emerald-600 bg-emerald-50' },
};

export function AdminTestsPage({ roleFilter = 'candidate' }: { roleFilter?: 'candidate' | 'worker' }) {
  const isWorkerTab = roleFilter === 'worker';
  const [tests, setTests] = useState<(Test & { section_count?: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTest, setExpandedTest] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTest, setEditingTest] = useState<Test | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Test | null>(null);

  const fetchTests = useCallback(async () => {
    try {
      const { data: testsData, error: testsErr } = await supabase.from('tests').select('*').order('created_at', { ascending: false });
      if (testsErr) console.error('Error fetching tests:', testsErr);

      const testIds = (testsData || []).map((t) => t.id);
      let sectionCounts: Record<string, number> = {};
      if (testIds.length > 0) {
        const { data: sections, error: secErr } = await supabase.from('sections').select('test_id').in('test_id', testIds);
        if (secErr) console.error('Error fetching sections:', secErr);
        (sections || []).forEach((s) => {
          sectionCounts[s.test_id] = (sectionCounts[s.test_id] || 0) + 1;
        });
      }

      const all = (testsData || []).map((t) => ({ ...t, section_count: sectionCounts[t.id] || 0 })) as (Test & { section_count?: number })[];

      const filtered = all.filter((t) => {
        const isWorkerTest = t.target_role === 'worker' || t.description?.includes('[ROLE:worker]');
        return isWorkerTab ? isWorkerTest : !isWorkerTest;
      });

      setTests(filtered);
    } catch (err) {
      console.error('Failed to load tests:', err);
    } finally {
      setLoading(false);
    }
  }, [isWorkerTab]);

  useEffect(() => { fetchTests(); }, [fetchTests]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await supabase.rpc('delete_test', { p_test_id: deleteTarget.id });
    setDeleteTarget(null);
    fetchTests();
  };

  const handleStatusChange = async (test: Test, status: TestStatus) => {
    let res = await supabase.rpc('update_test', {
      p_test_id: test.id,
      p_title: test.title,
      p_description: test.description,
      p_pass_mark: test.pass_mark,
      p_status: status,
      p_review_mode: test.review_mode || 'super_admin_approval',
      p_retakes_allowed: test.retakes_allowed ?? 0,
      p_retake_on_fail_only: test.retake_on_fail_only ?? true,
      p_target_role: test.target_role || (isWorkerTab ? 'worker' : 'candidate'),
    });

    if (res.error) {
      res = await supabase.rpc('update_test', {
        p_test_id: test.id,
        p_title: test.title,
        p_description: test.description,
        p_pass_mark: test.pass_mark,
        p_status: status,
        p_review_mode: test.review_mode || 'super_admin_approval',
        p_retakes_allowed: test.retakes_allowed ?? 0,
        p_retake_on_fail_only: test.retake_on_fail_only ?? true,
      });
    }

    if (res.error) {
      res = await supabase.rpc('update_test', {
        p_test_id: test.id,
        p_title: test.title,
        p_description: test.description,
        p_pass_mark: test.pass_mark,
        p_status: status,
        p_review_mode: test.review_mode || 'super_admin_approval',
      });
    }

    if (res.error) {
      res = await supabase.rpc('update_test', {
        p_test_id: test.id,
        p_title: test.title,
        p_description: test.description,
        p_pass_mark: test.pass_mark,
        p_status: status,
      });
    }

    if (res.error) {
      alert(res.error.message || 'Failed to update test status');
    }

    fetchTests();
  };

  if (loading) {
    return (
      <RouteGuard roles={['admin', 'super_admin']}>
        <AdminLayout current={isWorkerTab ? '/admin/worker-tests' : '/admin/tests'}>
          <div className="flex justify-center py-20"><Spinner size={32} /></div>
        </AdminLayout>
      </RouteGuard>
    );
  }

  return (
    <RouteGuard roles={['admin', 'super_admin']}>
      <AdminLayout current={isWorkerTab ? '/admin/worker-tests' : '/admin/tests'}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-serif">
                {isWorkerTab ? 'Workers Tests' : 'Candidate Tests'}
              </h1>
              <Badge color={isWorkerTab ? 'purple' : 'blue'}>
                {isWorkerTab ? 'Workers' : 'Candidates'}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {isWorkerTab
                ? 'Create, manage, and assign tests and certification exams for workers'
                : 'Create and manage certification exams and tests for candidates'}
            </p>
          </div>
          <Button
            onClick={() => setShowCreate(true)}
            className={isWorkerTab ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-md shadow-purple-600/20' : ''}
          >
            <Plus size={16} /> {isWorkerTab ? 'New Worker Test' : 'New Candidate Test'}
          </Button>
        </div>

        {tests.length === 0 ? (
          <Card>
            <EmptyState
              icon={isWorkerTab ? <Briefcase size={28} className="text-purple-600" /> : <GraduationCap size={28} className="text-blue-600" />}
              title={isWorkerTab ? 'No workers tests yet' : 'No candidate tests yet'}
              description={
                isWorkerTab
                  ? 'Create your first test for workers to get started.'
                  : 'Create your first candidate certification exam to get started.'
              }
              action={
                <Button
                  onClick={() => setShowCreate(true)}
                  className={isWorkerTab ? 'bg-purple-600 hover:bg-purple-700 text-white mt-2' : 'mt-2'}
                >
                  <Plus size={16} /> {isWorkerTab ? 'Create Worker Test' : 'Create Candidate Test'}
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {tests.map((test) => (
              <div key={test.id}>
                <Card className="overflow-visible">
                  <div className="flex items-center justify-between p-4">
                    <button
                      onClick={() => setExpandedTest(expandedTest === test.id ? null : test.id)}
                      className="flex items-center gap-3 flex-1 text-left"
                    >
                      {expandedTest === test.id ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
                      <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-700 dark:text-blue-300">
                        <FileText size={20} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 dark:text-white">{test.title}</h3>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <Badge color={test.status === 'published' ? 'green' : test.status === 'archived' ? 'slate' : 'amber'}>
                            {test.status}
                          </Badge>
                          <span className="text-xs text-slate-500 dark:text-slate-400">{test.section_count || 0} sections</span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">Pass: {test.pass_mark}%</span>
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${test.review_mode === 'immediate' ? 'bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 border border-amber-200 dark:border-amber-800' : 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-800'}`}>
                            {test.review_mode === 'immediate' ? <Zap size={10} /> : <ShieldCheck size={10} />}
                            {test.review_mode === 'immediate' ? 'Immediate Review' : 'Super Admin Approval'}
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            <RotateCcw size={10} />
                            {test.retakes_allowed === -1
                              ? 'Unlimited Retakes'
                              : test.retakes_allowed && test.retakes_allowed > 0
                              ? `${test.retakes_allowed} Retake${test.retakes_allowed > 1 ? 's' : ''}`
                              : 'No Retakes'}
                          </span>
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
                            test.target_role === 'worker' || test.description?.includes('[ROLE:worker]')
                              ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                              : 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                          }`}>
                            {test.target_role === 'worker' || test.description?.includes('[ROLE:worker]') ? <Briefcase size={10} /> : <GraduationCap size={10} />}
                            {test.target_role === 'worker' || test.description?.includes('[ROLE:worker]') ? 'Workers Only' : 'Candidates Only'}
                          </span>
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      {test.status === 'draft' && (
                        <Button size="sm" variant="success" onClick={() => handleStatusChange(test, 'published')}>
                          <Send size={14} /> Publish
                        </Button>
                      )}
                      {test.status === 'published' && (
                        <Button size="sm" variant="secondary" onClick={() => handleStatusChange(test, 'archived')}>
                          <Archive size={14} /> Archive
                        </Button>
                      )}
                      {test.status === 'archived' && (
                        <Button size="sm" variant="secondary" onClick={() => handleStatusChange(test, 'draft')}>
                          <Archive size={14} /> Unarchive
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditingTest(test)}>
                        <Edit3 size={14} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(test)}>
                        <Trash2 size={14} className="text-red-500" />
                      </Button>
                    </div>
                  </div>
                  {expandedTest === test.id && (
                    <TestBuilder test={test} onUpdated={fetchTests} />
                  )}
                </Card>
              </div>
            ))}
          </div>
        )}

        {(showCreate || editingTest) && (
          <TestEditorModal
            test={editingTest}
            defaultTargetRole={isWorkerTab ? 'worker' : 'candidate'}
            onClose={() => { setShowCreate(false); setEditingTest(null); }}
            onSaved={() => { setShowCreate(false); setEditingTest(null); fetchTests(); }}
          />
        )}

        <ConfirmDialog
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title="Delete Test"
          message={`Are you sure you want to delete "${deleteTarget?.title}"? This will also delete all sections, questions, and options. This cannot be undone.`}
          confirmLabel="Delete"
          danger
        />
      </AdminLayout>
    </RouteGuard>
  );
}

function TestEditorModal({
  test,
  onClose,
  onSaved,
  defaultTargetRole = 'candidate',
}: {
  test: Test | null;
  onClose: () => void;
  onSaved: () => void;
  defaultTargetRole?: 'candidate' | 'worker';
}) {
  const isWorkerTarget = defaultTargetRole === 'worker' || test?.target_role === 'worker' || test?.description?.includes('[ROLE:worker]');
  const rawDesc = test?.description || '';
  const initialCleanDesc = rawDesc.replace(/\[ROLE:(worker|candidate)\]/g, '').trim();

  const [title, setTitle] = useState(test?.title || '');
  const [description, setDescription] = useState(initialCleanDesc);
  const [passMark, setPassMark] = useState(test?.pass_mark ?? 70);
  const [status, setStatus] = useState<TestStatus>(test?.status || 'draft');
  const [reviewMode, setReviewMode] = useState<ReviewMode>(test?.review_mode || 'super_admin_approval');
  const [retakesAllowed, setRetakesAllowed] = useState<number>(test?.retakes_allowed ?? 0);
  const [retakeOnFailOnly, setRetakeOnFailOnly] = useState<boolean>(test?.retake_on_fail_only ?? true);
  const [saving, setSaving] = useState(false);

  // Target role is strictly locked to worker in Workers Tests and candidate in Candidate Tests
  const targetRole: 'candidate' | 'worker' = isWorkerTarget ? 'worker' : 'candidate';

  const handleSave = async () => {
    if (!title.trim()) {
      alert('Please enter a test title');
      return;
    }
    setSaving(true);

    let taggedDesc = description.replace(/\[ROLE:(worker|candidate)\]/g, '').trim();
    if (targetRole === 'worker') {
      taggedDesc = taggedDesc ? `${taggedDesc} [ROLE:worker]` : '[ROLE:worker]';
    } else {
      taggedDesc = taggedDesc ? `${taggedDesc} [ROLE:candidate]` : '[ROLE:candidate]';
    }

    try {
      if (test) {
        let res = await supabase.rpc('update_test', {
          p_test_id: test.id,
          p_title: title.trim(),
          p_description: taggedDesc,
          p_pass_mark: passMark,
          p_status: status,
          p_review_mode: reviewMode,
          p_retakes_allowed: retakesAllowed,
          p_retake_on_fail_only: retakeOnFailOnly,
          p_target_role: targetRole,
        });

        if (res.error) {
          res = await supabase.rpc('update_test', {
            p_test_id: test.id,
            p_title: title.trim(),
            p_description: taggedDesc,
            p_pass_mark: passMark,
            p_status: status,
            p_review_mode: reviewMode,
            p_retakes_allowed: retakesAllowed,
            p_retake_on_fail_only: retakeOnFailOnly,
          });
        }

        if (res.error) {
          res = await supabase.rpc('update_test', {
            p_test_id: test.id,
            p_title: title.trim(),
            p_description: taggedDesc,
            p_pass_mark: passMark,
            p_status: status,
            p_review_mode: reviewMode,
          });
        }

        if (res.error) {
          res = await supabase.rpc('update_test', {
            p_test_id: test.id,
            p_title: title.trim(),
            p_description: taggedDesc,
            p_pass_mark: passMark,
            p_status: status,
          });
        }

        if (res.error) throw new Error(res.error.message || 'Failed to update test');
        try {
          await supabase.from('tests').update({ target_role: targetRole }).eq('id', test.id);
        } catch {
          // best effort
        }
      } else {
        let res = await supabase.rpc('create_test', {
          p_title: title.trim(),
          p_description: taggedDesc,
          p_pass_mark: passMark,
          p_review_mode: reviewMode,
          p_retakes_allowed: retakesAllowed,
          p_retake_on_fail_only: retakeOnFailOnly,
          p_target_role: targetRole,
        });

        if (res.error) {
          res = await supabase.rpc('create_test', {
            p_title: title.trim(),
            p_description: taggedDesc,
            p_pass_mark: passMark,
            p_review_mode: reviewMode,
            p_retakes_allowed: retakesAllowed,
            p_retake_on_fail_only: retakeOnFailOnly,
          });
        }

        if (res.error) {
          res = await supabase.rpc('create_test', {
            p_title: title.trim(),
            p_description: taggedDesc,
            p_pass_mark: passMark,
            p_review_mode: reviewMode,
          });
        }

        if (res.error) {
          res = await supabase.rpc('create_test', {
            p_title: title.trim(),
            p_description: taggedDesc,
            p_pass_mark: passMark,
          });
        }

        if (res.error) throw new Error(res.error.message || 'Failed to create test');
        if (res.data) {
          try {
            await supabase.from('tests').update({ target_role: targetRole }).eq('id', res.data);
          } catch {
            // best effort
          }
        }
      }
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save test');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={
        test
          ? isWorkerTarget
            ? 'Edit Worker Test'
            : 'Edit Candidate Test'
          : isWorkerTarget
          ? 'Create New Worker Test'
          : 'Create New Candidate Test'
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Test Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="AWS Certified Solutions Architect" />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A comprehensive certification exam..." rows={3} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Pass Mark (%)</Label>
            <Input type="number" min={0} max={100} value={passMark} onChange={(e) => setPassMark(Number(e.target.value))} />
          </div>
          {test && (
            <div>
              <Label>Status</Label>
              <Select value={status} onChange={(e) => setStatus(e.target.value as TestStatus)}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="archived">Archived</option>
              </Select>
            </div>
          )}
        </div>

        {/* Retakes & Limits Configuration */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3">
          <div className="flex items-center gap-2">
            <RotateCcw size={16} className={isWorkerTarget ? 'text-purple-600 dark:text-purple-400' : 'text-blue-600 dark:text-blue-400'} />
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {isWorkerTarget ? 'Worker Retake Policy & Limits' : 'Candidate Retake Policy & Limits'}
            </h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isWorkerTarget
              ? 'Set retake limits so workers can retake this evaluation when they fail.'
              : 'Set retake limits so candidates can automatically retake this assessment when they fail.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <Label>Allowed Retakes</Label>
              <Select
                value={retakesAllowed === -1 ? 'unlimited' : retakesAllowed.toString()}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'unlimited') setRetakesAllowed(-1);
                  else setRetakesAllowed(Number(val));
                }}
              >
                <option value="0">No Retakes (Single attempt)</option>
                <option value="1">1 Retake allowed</option>
                <option value="2">2 Retakes allowed</option>
                <option value="3">3 Retakes allowed</option>
                <option value="5">5 Retakes allowed</option>
                <option value="10">10 Retakes allowed</option>
                <option value="unlimited">Always allow retakes (Unlimited)</option>
              </Select>
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={retakeOnFailOnly}
                  onChange={(e) => setRetakeOnFailOnly(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-700 dark:bg-slate-800"
                />
                <span>Only allow retake on failure</span>
              </label>
            </div>
          </div>
        </div>

        <div>
          <Label>Score Release Mode</Label>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <button
              type="button"
              onClick={() => setReviewMode('immediate')}
              className={`text-left p-3 rounded-xl border-2 transition-all ${reviewMode === 'immediate' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-600' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Zap size={16} className={reviewMode === 'immediate' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'} />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Immediate Review</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isWorkerTarget
                  ? 'Workers see their score immediately after completing the test.'
                  : 'Candidates see their score immediately after completing the test.'}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setReviewMode('super_admin_approval')}
              className={`text-left p-3 rounded-xl border-2 transition-all ${reviewMode === 'super_admin_approval' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-600' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={16} className={reviewMode === 'super_admin_approval' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'} />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Super Admin Approval</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Scores stay pending until a Super Admin reviews and approves them.</p>
            </button>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title}>
            {saving ? <Spinner /> : test ? 'Save Changes' : 'Create Test'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function TestBuilder({ test, onUpdated }: { test: Test; onUpdated: () => void }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSectionModal, setShowSectionModal] = useState(false);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [deleteSection, setDeleteSection] = useState<Section | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const fetchSections = useCallback(async () => {
    const { data } = await supabase.from('sections').select('*').eq('test_id', test.id).order('order_index', { ascending: true });
    setSections((data || []) as Section[]);
    setLoading(false);
  }, [test.id]);

  useEffect(() => { fetchSections(); }, [fetchSections]);

  const handleDeleteSection = async () => {
    if (!deleteSection) return;
    await supabase.rpc('delete_section', { p_section_id: deleteSection.id });
    setDeleteSection(null);
    fetchSections();
    onUpdated();
  };

  if (loading) return <div className="p-4"><Spinner /></div>;

  return (
    <div className="border-t border-slate-200 p-4 bg-slate-50/50">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-700">Sections</h4>
        <Button size="sm" variant="secondary" onClick={() => setShowSectionModal(true)}>
          <Plus size={14} /> Add Section
        </Button>
      </div>

      {sections.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-4">No sections yet. Add a section to start building questions.</p>
      ) : (
        <div className="space-y-2">
          {sections.map((section, idx) => (
            <div key={section.id}>
              <Card className="overflow-visible">
                <div className="flex items-center justify-between p-3">
                  <button
                    onClick={() => setExpandedSection(expandedSection === section.id ? null : section.id)}
                    className="flex items-center gap-2 flex-1 text-left"
                  >
                    {expandedSection === section.id ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                    <GripVertical size={16} className="text-slate-300" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">{idx + 1}. {section.title}</p>
                      <p className="text-xs text-slate-500">{section.timer_minutes} min timer</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditingSection(section)}><Edit3 size={14} /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteSection(section)}><Trash2 size={14} className="text-red-500" /></Button>
                  </div>
                </div>
                {expandedSection === section.id && (
                  <QuestionBuilder section={section} />
                )}
              </Card>
            </div>
          ))}
        </div>
      )}

      {(showSectionModal || editingSection) && (
        <SectionEditorModal
          testId={test.id}
          section={editingSection}
          onClose={() => { setShowSectionModal(false); setEditingSection(null); }}
          onSaved={() => { setShowSectionModal(false); setEditingSection(null); fetchSections(); onUpdated(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteSection}
        onClose={() => setDeleteSection(null)}
        onConfirm={handleDeleteSection}
        title="Delete Section"
        message={`Delete "${deleteSection?.title}" and all its questions? This cannot be undone.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function SectionEditorModal({ testId, section, onClose, onSaved }: { testId: string; section: Section | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(section?.title || '');
  const [timer, setTimer] = useState(section?.timer_minutes ?? 30);
  const [instructions, setInstructions] = useState(section?.instructions || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (section) {
        await supabase.rpc('update_section', {
          p_section_id: section.id, p_title: title, p_timer_minutes: timer, p_instructions: instructions,
        });
      } else {
        await supabase.rpc('create_section', {
          p_test_id: testId, p_title: title, p_timer_minutes: timer, p_instructions: instructions,
        });
      }
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title={section ? 'Edit Section' : 'Add Section'}>
      <div className="space-y-4">
        <div>
          <Label>Section Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reading Comprehension" />
        </div>
        <div>
          <Label>Timer (minutes)</Label>
          <Input type="number" min={1} value={timer} onChange={(e) => setTimer(Number(e.target.value))} />
        </div>
        <div>
          <Label>Instructions (shown to candidates)</Label>
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Read each question carefully..." rows={3} />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title}>
            {saving ? <Spinner /> : section ? 'Save' : 'Add Section'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function QuestionBuilder({ section }: { section: Section }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [editingQ, setEditingQ] = useState<Question | null>(null);
  const [newQType, setNewQType] = useState<QuestionType | null>(null);
  const [deleteQ, setDeleteQ] = useState<Question | null>(null);

  const fetchQuestions = useCallback(async () => {
    const { data } = await supabase.from('questions').select('*').eq('section_id', section.id).order('order_index', { ascending: true });
    setQuestions((data || []) as Question[]);
    setLoading(false);
  }, [section.id]);

  useEffect(() => { fetchQuestions(); }, [fetchQuestions]);

  const handleDelete = async () => {
    if (!deleteQ) return;
    await supabase.rpc('delete_question', { p_question_id: deleteQ.id });
    setDeleteQ(null);
    fetchQuestions();
  };

  if (loading) return <div className="p-3"><Spinner /></div>;

  return (
    <div className="border-t border-slate-200 p-3 bg-white">
      <div className="flex items-center justify-between mb-3">
        <h5 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Questions</h5>
        <div className="relative z-30">
          <Button size="sm" variant="secondary" onClick={() => setShowTypeMenu(!showTypeMenu)}>
            <Plus size={14} /> Add Question
          </Button>
          {showTypeMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowTypeMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-2 w-56 animate-scale-in">
                {(Object.keys(QUESTION_TYPE_META) as QuestionType[]).map((type) => {
                  const meta = QUESTION_TYPE_META[type];
                  return (
                    <button
                      key={type}
                      onClick={() => { setNewQType(type); setShowTypeMenu(false); }}
                      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors"
                    >
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${meta.color}`}>{meta.icon}</span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {questions.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-3">No questions yet.</p>
      ) : (
        <div className="space-y-2">
          {questions.map((q, idx) => {
            const meta = QUESTION_TYPE_META[q.question_type] || QUESTION_TYPE_META.single_choice;
            return (
              <div key={q.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200">
                <GripVertical size={16} className="text-slate-300" />
                <span className="text-sm font-medium text-slate-600 w-6">{idx + 1}.</span>
                <span className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${meta.color}`}>{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 truncate">{q.question_text || q.instructions || 'Untitled question'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-slate-400">{meta.label}</span>
                    {q.question_image && <span className="text-xs text-blue-500 flex items-center gap-0.5"><ImageIcon size={10} /> Image</span>}
                    {q.external_link && <span className="text-xs text-blue-500 flex items-center gap-0.5"><ExternalLink size={10} /> Link</span>}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditingQ(q)}><Edit3 size={14} /></Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleteQ(q)}><Trash2 size={14} className="text-red-500" /></Button>
              </div>
            );
          })}
        </div>
      )}

      {(newQType !== null || editingQ) && (
        <QuestionEditorModal
          sectionId={section.id}
          question={editingQ}
          defaultType={newQType || undefined}
          onClose={() => { setNewQType(null); setEditingQ(null); }}
          onSaved={() => { setNewQType(null); setEditingQ(null); fetchQuestions(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleteQ}
        onClose={() => setDeleteQ(null)}
        onConfirm={handleDelete}
        title="Delete Question"
        message="Delete this question and all its options? This cannot be undone."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}

function QuestionEditorModal({ sectionId, question, defaultType, onClose, onSaved }: {
  sectionId: string; question: Question | null; defaultType?: QuestionType; onClose: () => void; onSaved: () => void;
}) {
  const [questionType, setQuestionType] = useState<QuestionType>(question?.question_type || defaultType || 'single_choice');
  const [questionText, setQuestionText] = useState(question?.question_text || '');
  const [imagePath, setImagePath] = useState(question?.question_image || '');
  const [instructions, setInstructions] = useState(question?.instructions || '');
  const [links, setLinks] = useState<QuestionLink[]>([]);
  const [initialLinkIds, setInitialLinkIds] = useState<string[]>([]);
  const [minSelections, setMinSelections] = useState<number | ''>(question?.min_selections ?? '');
  const [maxSelections, setMaxSelections] = useState<number | ''>(question?.max_selections ?? '');
  const [charLimit, setCharLimit] = useState<number | ''>(question?.char_limit ?? '');
  const [scoringMode, setScoringMode] = useState<ScoringMode>(question?.scoring_mode || 'all_or_nothing');
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(!!question);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showImage, setShowImage] = useState(!!question?.question_image);

  const hasOptions = ['single_choice', 'multi_select', 'dropdown', 'true_false'].includes(questionType);
  const isMultiSelect = questionType === 'multi_select';
  const isText = questionType === 'text_short' || questionType === 'text_long';

  useEffect(() => {
    if (!question) {
      if (questionType === 'true_false') {
        setOptions([
          { id: '', question_id: '', option_label: 'A', option_text: 'True', is_correct: true },
          { id: '', question_id: '', option_label: 'B', option_text: 'False', is_correct: false },
        ]);
      }
      setLoading(false);
      return;
    }
    (async () => {
      const { data } = await supabase.from('options').select('*').eq('question_id', question.id).order('option_label', { ascending: true });
      setOptions((data || []) as Option[]);

      const { data: linkData } = await supabase.from('question_links').select('*').eq('question_id', question.id).order('order_index', { ascending: true });
      const loadedLinks = (linkData || []) as QuestionLink[];
      setLinks(loadedLinks);
      setInitialLinkIds(loadedLinks.map((link) => link.id));
      setLoading(false);
    })();
  }, [question, questionType]);

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) { alert('Please upload a PNG or JPG image'); return; }
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const fileName = `${sectionId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('question-images').upload(fileName, file);
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('question-images').getPublicUrl(fileName);
      setImagePath(urlData.publicUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const params = {
        p_question_image: imagePath,
        p_instructions: instructions,
        p_external_link: '',
        p_question_type: questionType,
        p_question_text: questionText,
        p_min_selections: minSelections === '' ? null : Number(minSelections),
        p_max_selections: maxSelections === '' ? null : Number(maxSelections),
        p_char_limit: charLimit === '' ? null : Number(charLimit),
        p_scoring_mode: scoringMode,
      };

      let questionId = question?.id;
      if (question) {
        await supabase.rpc('update_question', { p_question_id: question.id, ...params });
      } else {
        const { data } = await supabase.rpc('create_question', { p_section_id: sectionId, ...params });
        questionId = data as string;
      }
      if (!questionId) throw new Error('Failed to get question ID');

      if (hasOptions) {
        for (const opt of options) {
          await supabase.rpc('save_option', {
            p_option_id: opt.id || null, p_question_id: questionId,
            p_option_label: opt.option_label, p_option_text: opt.option_text, p_is_correct: opt.is_correct,
          });
        }
      }

      // Remove links deleted in the editor
      const currentLinkIds = new Set(links.map((link) => link.id));
      for (const linkId of initialLinkIds) {
        if (!currentLinkIds.has(linkId)) {
          await supabase.rpc('delete_question_link', { p_link_id: linkId });
        }
      }

      // Save links
      for (const link of links) {
        const normalizedUrl = normalizeExternalUrl(link.url);
        if (!normalizedUrl) continue;
        await supabase.rpc('save_question_link', {
          p_link_id: link.id || null,
          p_question_id: questionId,
          p_url: normalizedUrl,
          p_label: link.label,
          p_order_index: link.order_index,
        });
      }

      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const addOption = () => {
    const nextLabel = String.fromCharCode(65 + options.length);
    setOptions([...options, { id: '', question_id: '', option_label: nextLabel, option_text: '', is_correct: false }]);
  };

  const updateOption = (idx: number, field: keyof Option, value: string | boolean) => {
    const updated = [...options];
    if (field === 'is_correct') {
      if (isMultiSelect) {
        updated[idx] = { ...updated[idx], is_correct: !updated[idx].is_correct };
      } else {
        updated.forEach((o, i) => { updated[i] = { ...o, is_correct: i === idx }; });
      }
    } else {
      updated[idx] = { ...updated[idx], [field]: value };
    }
    setOptions(updated);
  };

  const removeOption = (idx: number) => {
    setOptions(options.filter((_, i) => i !== idx));
  };

  const canSave = questionText.trim().length > 0 || imagePath.length > 0;
  const meta = QUESTION_TYPE_META[questionType];

  if (loading) return <Modal open={true} onClose={onClose} title="Loading..."><div className="flex justify-center py-8"><Spinner /></div></Modal>;

  return (
    <Modal open={true} onClose={onClose} title={question ? 'Edit Question' : 'Add Question'} maxWidth="max-w-2xl">
      <div className="space-y-5">
        {/* Question type badge */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${meta.color}`}>
            {meta.icon} {meta.label}
          </span>
          {!question && (
            <Select
              value={questionType}
              onChange={(e) => {
                const t = e.target.value as QuestionType;
                setQuestionType(t);
                if (t === 'true_false') {
                  setOptions([
                    { id: '', question_id: '', option_label: 'A', option_text: 'True', is_correct: true },
                    { id: '', question_id: '', option_label: 'B', option_text: 'False', is_correct: false },
                  ]);
                } else if (!['single_choice', 'multi_select', 'dropdown'].includes(t)) {
                  setOptions([]);
                }
              }}
              className="text-sm"
            >
              {(Object.keys(QUESTION_TYPE_META) as QuestionType[]).map((t) => (
                <option key={t} value={t}>{QUESTION_TYPE_META[t].label}</option>
              ))}
            </Select>
          )}
        </div>

        {/* Question text */}
        <div>
          <Label>Question Text</Label>
          <Textarea
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            placeholder="Enter your question here..."
            rows={3}
          />
        </div>

        {/* Optional image */}
        <div>
          {!showImage && !imagePath ? (
            <button
              onClick={() => setShowImage(true)}
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1.5 font-medium"
            >
              <ImageIcon size={14} /> Add Image (optional)
            </button>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Question Image (optional)</Label>
                {!imagePath && <button onClick={() => setShowImage(false)} className="text-xs text-slate-400 hover:text-slate-600">Remove</button>}
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
                className={`border-2 border-dashed rounded-xl p-4 text-center transition-colors ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-slate-400'}`}
              >
                {imagePath ? (
                  <div className="relative">
                    <img src={imagePath} alt="Question" className="max-h-36 mx-auto rounded-lg" />
                    <button onClick={() => setImagePath('')} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 flex items-center justify-center text-slate-600 hover:text-red-500">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-3">
                    {uploading ? <Spinner /> : <Upload size={20} className="text-slate-400" />}
                    <span className="text-sm text-slate-500">{uploading ? 'Uploading...' : 'Drag & drop or'}</span>
                    <label className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-100 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-200 transition-colors">
                      Browse
                      <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div>
          <Label>Instructions (optional)</Label>
          <Input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Additional instructions for the candidate..." />
        </div>

        {/* External links */}
        <div>
          <Label>Reference Links (optional)</Label>
          <div className="space-y-2">
            {links.map((link, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  value={link.label}
                  onChange={(e) => { const updated = [...links]; updated[idx] = { ...link, label: e.target.value }; setLinks(updated); }}
                  placeholder="Label (e.g. Datasheet)"
                  className="w-36 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  value={link.url}
                  onChange={(e) => { const updated = [...links]; updated[idx] = { ...link, url: e.target.value }; setLinks(updated); }}
                  placeholder="https://example.com/reference"
                  type="url"
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setLinks(links.filter((_, i) => i !== idx))}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLinks([...links, { id: '', question_id: question?.id || '', url: '', label: '', order_index: links.length }])}
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1.5 font-medium"
            >
              <Plus size={14} /> Add Link
            </button>
          </div>
        </div>

        {/* Text question settings */}
        {isText && (
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Text Answer Settings</p>
            <div>
              <Label>Character Limit (optional)</Label>
              <Input
                type="number"
                min={1}
                value={charLimit}
                onChange={(e) => setCharLimit(e.target.value ? Number(e.target.value) : '')}
                placeholder="No limit"
              />
            </div>
          </div>
        )}

        {/* Multi-select settings */}
        {isMultiSelect && (
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Multi-Select Settings</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Min Selections</Label>
                <Input
                  type="number"
                  min={1}
                  value={minSelections}
                  onChange={(e) => setMinSelections(e.target.value ? Number(e.target.value) : '')}
                  placeholder="1"
                />
              </div>
              <div>
                <Label>Max Selections</Label>
                <Input
                  type="number"
                  min={1}
                  value={maxSelections}
                  onChange={(e) => setMaxSelections(e.target.value ? Number(e.target.value) : '')}
                  placeholder="All"
                />
              </div>
            </div>
            <div>
              <Label>Scoring Mode</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setScoringMode('all_or_nothing')}
                  className={`text-left p-2.5 rounded-lg border-2 transition-all text-xs ${scoringMode === 'all_or_nothing' ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <span className="font-semibold text-slate-800">All or Nothing</span>
                  <p className="text-slate-500 mt-0.5">Must select all correct options exactly.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setScoringMode('partial_credit')}
                  className={`text-left p-2.5 rounded-lg border-2 transition-all text-xs ${scoringMode === 'partial_credit' ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <span className="font-semibold text-slate-800">Partial Credit</span>
                  <p className="text-slate-500 mt-0.5">Points awarded proportionally.</p>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Options editor */}
        {hasOptions && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>{isMultiSelect ? 'Options (mark all correct answers)' : 'Options (mark the correct answer)'}</Label>
              {questionType !== 'true_false' && (
                <Button size="sm" variant="secondary" onClick={addOption} disabled={options.length >= 10}>
                  <Plus size={14} /> Add Option
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
                    {opt.option_label}
                  </span>
                  <Input
                    value={opt.option_text}
                    onChange={(e) => updateOption(idx, 'option_text', e.target.value)}
                    placeholder="Option text..."
                    className="flex-1"
                    disabled={questionType === 'true_false'}
                  />
                  <button
                    onClick={() => updateOption(idx, 'is_correct', true)}
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      opt.is_correct ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                    }`}
                    title="Mark as correct"
                  >
                    <Check size={16} />
                  </button>
                  {questionType !== 'true_false' && (
                    <button
                      onClick={() => removeOption(idx)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
              {options.length === 0 && hasOptions && (
                <p className="text-sm text-slate-400 text-center py-2">No options yet. Add at least two.</p>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving ? <Spinner /> : question ? 'Save Changes' : 'Add Question'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
