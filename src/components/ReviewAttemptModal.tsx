import { useState, useEffect, useCallback } from 'react';
import { supabase, callAdminApi } from '@/lib/supabase';
import { Badge, Button, Spinner, Card } from '@/components/ui';
import { printAttemptPdf } from '@/lib/printResult';
import type { ReviewData, QuestionType, Answer } from '@/types';
import {
  X, CheckCircle2, XCircle, Award, Printer, Save, Send, Clock,
  FileText, ExternalLink, RotateCcw, AlertCircle, Check, Eye, ZoomIn, Briefcase, GraduationCap
} from 'lucide-react';

interface ReviewAttemptModalProps {
  open: boolean;
  attemptId: string | null;
  onClose: () => void;
  onUpdated?: () => void;
}

export function ReviewAttemptModal({
  open,
  attemptId,
  onClose,
  onUpdated,
}: ReviewAttemptModalProps) {
  const [loading, setLoading] = useState(false);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [grantRetake, setGrantRetake] = useState(false);
  const [retakeCount, setRetakeCount] = useState(1);
  const [releasing, setReleasing] = useState(false);
  const [releaseMsg, setReleaseMsg] = useState<string | null>(null);
  const [savingGrades, setSavingGrades] = useState(false);
  const [gradeSavedToast, setGradeSavedToast] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // question_id -> { grade, score, feedback }
  const [manualGrades, setManualGrades] = useState<
    Record<string, { grade: 'correct' | 'incorrect' | 'partial'; score: number; feedback: string }>
  >({});

  const loadReview = useCallback(async (id: string) => {
    setLoading(true);
    setReviewData(null);
    setAdminNotes('');
    setGrantRetake(false);
    setRetakeCount(1);
    setReleaseMsg(null);
    setGradeSavedToast(false);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      let data: ReviewData | null = null;
      if (token) {
        try {
          const res = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api/review-attempt?id=${id}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
            }
          );
          if (res.ok) {
            data = await res.json();
          }
        } catch {
          // Fall back to direct Supabase query
        }
      }

      if (!data) {
        const { data: attempt, error: attErr } = await supabase
          .from('attempts')
          .select('*')
          .eq('id', id)
          .single();
        if (attErr || !attempt) throw new Error('Attempt not found');

        const [{ data: test }, { data: candidateProfile }, { data: sections }] = await Promise.all([
          supabase.from('tests').select('title, pass_mark').eq('id', attempt.test_id).single(),
          supabase.from('profiles').select('name, email, role').eq('id', attempt.candidate_id).single(),
          supabase.from('sections').select('*').eq('test_id', attempt.test_id).order('order_index', { ascending: true }),
        ]);

        const sectionIds = (sections || []).map((s: { id: string }) => s.id);
        const { data: questions } = await supabase
          .from('questions')
          .select('*')
          .in('section_id', sectionIds)
          .order('order_index', { ascending: true });
        const questionIds = (questions || []).map((q: { id: string }) => q.id);

        const [{ data: options }, { data: links }] = await Promise.all([
          questionIds.length > 0 ? supabase.from('question_options').select('*').in('question_id', questionIds) : { data: [] },
          questionIds.length > 0 ? supabase.from('question_links').select('*').in('question_id', questionIds) : { data: [] },
        ]);

        data = {
          attempt,
          test_title: test?.title || 'Assessment',
          pass_mark: test?.pass_mark ?? 70,
          candidate_name: candidateProfile?.name || 'User',
          candidate_email: candidateProfile?.email || '',
          sections: sections || [],
          questions: questions || [],
          options: options || [],
          links: links || [],
        };
      }

      setReviewData(data);
      setAdminNotes(data.attempt?.admin_notes || '');

      // Initialize manual grades from attempt answers
      const initialGrades: Record<string, { grade: 'correct' | 'incorrect' | 'partial'; score: number; feedback: string }> = {};
      (data.attempt?.answers || []).forEach((ans: Answer) => {
        if (ans.manual_grade) {
          initialGrades[ans.question_id] = {
            grade: ans.manual_grade,
            score: ans.manual_score !== undefined ? ans.manual_score : (ans.manual_grade === 'correct' ? 1 : ans.manual_grade === 'partial' ? 0.5 : 0),
            feedback: ans.manual_feedback || '',
          };
        }
      });
      setManualGrades(initialGrades);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && attemptId) {
      loadReview(attemptId);
    } else {
      setReviewData(null);
    }
  }, [open, attemptId, loadReview]);

  if (!open) return null;

  const getCalculatedScore = (data: ReviewData, grades: typeof manualGrades) => {
    let autoCorrect = 0;
    let manualScoreSum = 0;

    data.questions.forEach((q) => {
      const candidateAnswer = data.attempt.answers?.find((a: Answer) => a.question_id === q.id);
      const isText = q.question_type === 'text_short' || q.question_type === 'text_long';

      if (isText) {
        const mg = grades[q.id];
        if (mg) manualScoreSum += mg.score;
      } else if (q.question_type === 'multi_select') {
        const sIds = candidateAnswer?.selected_option_ids;
        const qOptions = data.options.filter((o) => o.question_id === q.id);
        const correctCount = qOptions.filter((o) => o.is_correct).length;
        const isCorrect = (sIds || []).length > 0 &&
          (sIds || []).every((id: string) => qOptions.find((o) => o.id === id)?.is_correct) &&
          (sIds || []).length === correctCount;
        if (isCorrect) autoCorrect += 1;
      } else {
        const qOptions = data.options.filter((o) => o.question_id === q.id);
        const isCorrect = qOptions.find((o) => o.id === candidateAnswer?.selected_option_id)?.is_correct || false;
        if (isCorrect) autoCorrect += 1;
      }
    });

    const totalQuestions = data.questions.length || 1;
    const totalPointsEarned = autoCorrect + manualScoreSum;
    const finalScore = Math.min(100, Math.max(0, Math.round((totalPointsEarned / totalQuestions) * 100)));
    const passOrFail = finalScore >= data.pass_mark ? 'pass' : 'fail';
    const totalCorrectDisplay = Math.round(totalPointsEarned * 10) / 10;

    return { autoCorrect, manualScoreSum, totalPointsEarned, finalScore, passOrFail, totalCorrectDisplay, totalQuestions };
  };

  const handleSetManualGrade = (questionId: string, grade: 'correct' | 'incorrect' | 'partial', customScore?: number, feedback?: string) => {
    const scoreVal = customScore !== undefined ? customScore : (grade === 'correct' ? 1.0 : grade === 'partial' ? 0.5 : 0.0);
    setManualGrades((prev) => ({
      ...prev,
      [questionId]: {
        grade,
        score: scoreVal,
        feedback: feedback !== undefined ? feedback : (prev[questionId]?.feedback || ''),
      },
    }));
  };

  const handleSaveManualGrades = async () => {
    if (!reviewData) return;
    setSavingGrades(true);
    setGradeSavedToast(false);
    try {
      const { finalScore, passOrFail, totalCorrectDisplay, totalQuestions } = getCalculatedScore(reviewData, manualGrades);

      const updatedAnswers: Answer[] = reviewData.questions.map((q) => {
        const existing = reviewData.attempt.answers?.find((a: Answer) => a.question_id === q.id) || { question_id: q.id, selected_option_id: null };
        const mg = manualGrades[q.id];
        if (mg && (q.question_type === 'text_short' || q.question_type === 'text_long')) {
          return {
            ...existing,
            manual_grade: mg.grade,
            manual_score: mg.score,
            manual_feedback: mg.feedback,
          };
        }
        return existing;
      });

      const { error: updateErr } = await supabase
        .from('attempts')
        .update({
          answers: updatedAnswers,
          score: finalScore,
          pass_or_fail: passOrFail,
          correct_answers: Math.round(totalCorrectDisplay),
          total_questions: totalQuestions,
          admin_notes: adminNotes,
        })
        .eq('id', reviewData.attempt.id);

      if (updateErr) throw updateErr;

      setReviewData({
        ...reviewData,
        attempt: {
          ...reviewData.attempt,
          answers: updatedAnswers,
          score: finalScore,
          pass_or_fail: passOrFail,
          correct_answers: Math.round(totalCorrectDisplay),
          total_questions: totalQuestions,
          admin_notes: adminNotes,
        },
      });

      setGradeSavedToast(true);
      setTimeout(() => setGradeSavedToast(false), 3500);
      if (onUpdated) onUpdated();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save grades');
    } finally {
      setSavingGrades(false);
    }
  };

  const handleRelease = async () => {
    if (!reviewData) return;
    setReleasing(true);
    setReleaseMsg(null);

    const { finalScore, passOrFail, totalCorrectDisplay, totalQuestions } = getCalculatedScore(reviewData, manualGrades);
    const updatedAnswers: Answer[] = reviewData.questions.map((q) => {
      const existing = reviewData.attempt.answers?.find((a: Answer) => a.question_id === q.id) || { question_id: q.id, selected_option_id: null };
      const mg = manualGrades[q.id];
      if (mg && (q.question_type === 'text_short' || q.question_type === 'text_long')) {
        return {
          ...existing,
          manual_grade: mg.grade,
          manual_score: mg.score,
          manual_feedback: mg.feedback,
        };
      }
      return existing;
    });

    try {
      await supabase
        .from('attempts')
        .update({
          answers: updatedAnswers,
          score: finalScore,
          pass_or_fail: passOrFail,
          correct_answers: Math.round(totalCorrectDisplay),
          total_questions: totalQuestions,
          review_status: 'released',
          admin_notes: adminNotes,
        })
        .eq('id', reviewData.attempt.id);

      try {
        await callAdminApi('release-attempt', 'POST', {
          attemptId: reviewData.attempt.id,
          adminNotes,
          grantRetake,
          retakeCount: grantRetake ? retakeCount : 0,
        });
      } catch {
        if (grantRetake) {
          try {
            await callAdminApi('grant-retake', 'POST', {
              candidateId: reviewData.attempt.candidate_id,
              testId: reviewData.attempt.test_id,
              retakeCount,
            });
          } catch {}
        }
      }

      setReleaseMsg(`Score released successfully! Candidate has been credited. ${grantRetake ? 'Retake granted.' : ''}`);
      setReviewData({
        ...reviewData,
        attempt: {
          ...reviewData.attempt,
          answers: updatedAnswers,
          score: finalScore,
          pass_or_fail: passOrFail,
          correct_answers: Math.round(totalCorrectDisplay),
          total_questions: totalQuestions,
          review_status: 'released',
          admin_notes: adminNotes,
        },
      });
      if (onUpdated) onUpdated();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setReleasing(false);
    }
  };

  const activeCalc = reviewData ? getCalculatedScore(reviewData, manualGrades) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto border border-slate-200 dark:border-slate-800 flex flex-col">
        {loading ? (
          <div className="flex justify-center items-center py-24">
            <Spinner size={32} />
          </div>
        ) : reviewData && activeCalc ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-5 sm:p-6 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm z-20">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold font-serif text-slate-900 dark:text-white">
                    {reviewData.attempt.review_status === 'released'
                      ? 'Assessment Result Details'
                      : reviewData.attempt.review_status === 'reviewed'
                      ? 'Assessment Review Record'
                      : 'Review & Grade Attempt'}
                  </h2>
                  <Badge color={reviewData.attempt.review_status === 'released' ? 'green' : 'amber'}>
                    {reviewData.attempt.review_status.replace('_', ' ')}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{reviewData.candidate_name}</span>
                  {reviewData.candidate_email && <span>({reviewData.candidate_email})</span>}
                  <span>•</span>
                  <span>{reviewData.test_title}</span>
                  <span>•</span>
                  <span>{new Date(reviewData.attempt.submitted_at).toLocaleString()}</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => printAttemptPdf(reviewData.attempt.id, reviewData)}
                  title="Print official result report PDF"
                >
                  <Printer size={15} /> Print PDF
                </Button>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Score & Evaluation Bar */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">Calculated Grade</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">{activeCalc.finalScore}%</span>
                    <Badge color={activeCalc.passOrFail === 'pass' ? 'green' : 'red'}>
                      {activeCalc.passOrFail === 'pass' ? 'PASS' : 'FAIL'}
                    </Badge>
                  </div>
                </div>

                <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />

                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">Score Breakdown</span>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                    {activeCalc.totalPointsEarned} pts ({activeCalc.autoCorrect} auto + {activeCalc.manualScoreSum} manual) / {activeCalc.totalQuestions} questions
                  </p>
                </div>

                <div className="h-8 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />

                <div>
                  <span className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider">Pass Mark</span>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5">{reviewData.pass_mark}%</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveManualGrades}
                  disabled={savingGrades}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {savingGrades ? <Spinner size={14} /> : <Save size={14} />} Save Grades
                </Button>
              </div>
            </div>

            {/* Toasts */}
            {gradeSavedToast && (
              <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm flex items-center gap-2 animate-fade-in">
                <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Manual grades and points have been saved successfully to the database.</span>
              </div>
            )}
            {releaseMsg && (
              <div className="mx-6 mt-4 p-3 rounded-xl bg-green-50 dark:bg-green-950/60 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200 text-sm flex items-center gap-2 animate-fade-in">
                <Check size={16} className="text-green-600 dark:text-green-400 shrink-0" />
                <span>{releaseMsg}</span>
              </div>
            )}

            {/* Questions List */}
            <div className="p-6 space-y-8 flex-1">
              {reviewData.sections.map((section, sIdx) => {
                const sQuestions = reviewData.questions.filter((q) => q.section_id === section.id);
                if (sQuestions.length === 0) return null;

                return (
                  <div key={section.id} className="space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                      <span className="w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center">
                        {sIdx + 1}
                      </span>
                      <h3 className="font-bold text-slate-900 dark:text-white text-base font-serif">{section.title}</h3>
                      <span className="text-xs text-slate-400 ml-auto">{sQuestions.length} questions</span>
                    </div>

                    <div className="space-y-4">
                      {sQuestions.map((q, qIdx) => {
                        const candidateAnswer = reviewData.attempt.answers?.find((a: Answer) => a.question_id === q.id);
                        const qOptions = reviewData.options.filter((o) => o.question_id === q.id);
                        const qLinks = reviewData.links.filter((l) => l.question_id === q.id);
                        const isText = q.question_type === 'text_short' || q.question_type === 'text_long';

                        // Status of question
                        let isCorrect = false;
                        let autoGradeEvaluated = false;

                        if (isText) {
                          const mg = manualGrades[q.id];
                          isCorrect = mg?.grade === 'correct';
                        } else if (q.question_type === 'multi_select') {
                          autoGradeEvaluated = true;
                          const sIds = candidateAnswer?.selected_option_ids || [];
                          const correctCount = qOptions.filter((o) => o.is_correct).length;
                          isCorrect = sIds.length > 0 &&
                            sIds.every((id: string) => qOptions.find((o) => o.id === id)?.is_correct) &&
                            sIds.length === correctCount;
                        } else {
                          autoGradeEvaluated = true;
                          isCorrect = qOptions.find((o) => o.id === candidateAnswer?.selected_option_id)?.is_correct || false;
                        }

                        const mg = manualGrades[q.id];

                        return (
                          <div
                            key={q.id}
                            className={`p-4 rounded-xl border transition-all ${
                              isText
                                ? mg?.grade === 'correct'
                                  ? 'border-green-200 dark:border-green-900/60 bg-green-50/20 dark:bg-green-950/20'
                                  : mg?.grade === 'partial'
                                  ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/20'
                                  : mg?.grade === 'incorrect'
                                  ? 'border-red-200 dark:border-red-900/60 bg-red-50/20 dark:bg-red-950/20'
                                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                                : autoGradeEvaluated
                                ? isCorrect
                                  ? 'border-green-200 dark:border-green-900/60 bg-green-50/20 dark:bg-green-950/20'
                                  : 'border-red-200 dark:border-red-900/60 bg-red-50/20 dark:bg-red-950/20'
                                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-slate-700 dark:text-slate-300">
                                  Q{qIdx + 1}.
                                </span>
                                <Badge color="gray">
                                  {q.question_type.replace('_', ' ')}
                                </Badge>
                              </div>

                              <div>
                                {isText ? (
                                  mg ? (
                                    <Badge color={mg.grade === 'correct' ? 'green' : mg.grade === 'partial' ? 'amber' : 'red'}>
                                      {mg.grade === 'correct' ? 'Full Credit (1.0 pt)' : mg.grade === 'partial' ? `Partial (${mg.score} pt)` : 'No Credit (0 pt)'}
                                    </Badge>
                                  ) : (
                                    <Badge color="amber">Awaiting Manual Grading</Badge>
                                  )
                                ) : (
                                  <Badge color={isCorrect ? 'green' : 'red'}>
                                    {isCorrect ? 'Correct (1 pt)' : 'Incorrect (0 pt)'}
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {q.question_text && (
                              <p className="text-sm font-semibold text-slate-900 dark:text-white mb-2 leading-relaxed">
                                {q.question_text}
                              </p>
                            )}

                            {q.instructions && (
                              <p className="text-xs text-slate-500 dark:text-slate-400 mb-3 whitespace-pre-wrap leading-relaxed">
                                {q.instructions}
                              </p>
                            )}

                            {q.question_image && (
                              <div className="mb-3 relative group inline-block">
                                <img
                                  src={q.question_image}
                                  alt="Question visual"
                                  className="max-h-60 rounded-lg border border-slate-200 dark:border-slate-700 object-contain cursor-pointer"
                                  onClick={() => setZoomedImage(q.question_image)}
                                />
                                <button
                                  type="button"
                                  onClick={() => setZoomedImage(q.question_image)}
                                  className="absolute bottom-2 right-2 bg-slate-900/80 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs"
                                >
                                  <ZoomIn size={14} /> Zoom
                                </button>
                              </div>
                            )}

                            {qLinks.length > 0 && (
                              <div className="flex flex-wrap gap-2 mb-3">
                                {qLinks.map((l) => (
                                  <a
                                    key={l.id}
                                    href={l.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                  >
                                    <ExternalLink size={12} /> {l.label}
                                  </a>
                                ))}
                              </div>
                            )}

                            {/* Question Type: Short or Long Text Answer */}
                            {isText ? (
                              <div className="space-y-3 mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800">
                                <div>
                                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                                    Candidate's Submitted Answer:
                                  </span>
                                  <div className="p-3.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-slate-100 whitespace-pre-wrap font-sans leading-relaxed">
                                    {candidateAnswer?.text_answer ? (
                                      candidateAnswer.text_answer
                                    ) : (
                                      <span className="text-slate-400 italic">No answer submitted by candidate</span>
                                    )}
                                  </div>
                                </div>

                                {/* Manual Grading Controls */}
                                <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 rounded-xl border border-blue-200/80 dark:border-blue-900/60 space-y-2.5">
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span className="text-xs font-bold text-blue-950 dark:text-blue-200">
                                      Examiner Manual Grade:
                                    </span>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <button
                                        type="button"
                                        onClick={() => handleSetManualGrade(q.id, 'correct', 1.0)}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                                          mg?.grade === 'correct'
                                            ? 'bg-green-600 text-white shadow-xs'
                                            : 'bg-white dark:bg-slate-800 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-800 hover:bg-green-50'
                                        }`}
                                      >
                                        Full Credit (1.0 pt)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleSetManualGrade(q.id, 'partial', 0.5)}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                                          mg?.grade === 'partial'
                                            ? 'bg-amber-600 text-white shadow-xs'
                                            : 'bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-50'
                                        }`}
                                      >
                                        Partial (0.5 pt)
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleSetManualGrade(q.id, 'incorrect', 0.0)}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                                          mg?.grade === 'incorrect'
                                            ? 'bg-red-600 text-white shadow-xs'
                                            : 'bg-white dark:bg-slate-800 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 hover:bg-red-50'
                                        }`}
                                      >
                                        No Credit (0 pt)
                                      </button>
                                    </div>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1">
                                    <div className="sm:col-span-1">
                                      <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-0.5">Custom Pts (0-1):</label>
                                      <input
                                        type="number"
                                        min="0"
                                        max="1"
                                        step="0.1"
                                        value={mg?.score !== undefined ? mg.score : ''}
                                        onChange={(e) => {
                                          const val = parseFloat(e.target.value) || 0;
                                          const grade = val >= 1 ? 'correct' : val > 0 ? 'partial' : 'incorrect';
                                          handleSetManualGrade(q.id, grade, val);
                                        }}
                                        className="w-full px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                                        placeholder="1.0"
                                      />
                                    </div>
                                    <div className="sm:col-span-3">
                                      <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block mb-0.5">Examiner Feedback on Answer:</label>
                                      <input
                                        type="text"
                                        value={mg?.feedback || ''}
                                        onChange={(e) => handleSetManualGrade(q.id, mg?.grade || 'correct', mg?.score ?? 1.0, e.target.value)}
                                        placeholder="Optional feedback for this question..."
                                        className="w-full px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              /* Multiple choice / multi-select options */
                              <div className="space-y-1.5 mt-2">
                                {qOptions.map((opt) => {
                                  const isSelected = q.question_type === 'multi_select'
                                    ? (candidateAnswer?.selected_option_ids || []).includes(opt.id)
                                    : candidateAnswer?.selected_option_id === opt.id;
                                  const isCorrectOpt = opt.is_correct;

                                  let optBg = 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700';
                                  if (isSelected && isCorrectOpt) {
                                    optBg = 'bg-green-100 dark:bg-green-950/60 border-green-300 dark:border-green-800 text-green-900 dark:text-green-100';
                                  } else if (isSelected && !isCorrectOpt) {
                                    optBg = 'bg-red-100 dark:bg-red-950/60 border-red-300 dark:border-red-800 text-red-900 dark:text-red-100';
                                  } else if (isCorrectOpt) {
                                    optBg = 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100';
                                  }

                                  return (
                                    <div
                                      key={opt.id}
                                      className={`p-2.5 rounded-lg border text-xs sm:text-sm flex items-center justify-between gap-3 ${optBg}`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="font-bold w-5">{opt.option_label}.</span>
                                        <span>{opt.option_text}</span>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {isSelected && (
                                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200">
                                            Candidate Selected
                                          </span>
                                        )}
                                        {isCorrectOpt && (
                                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/60 text-green-800 dark:text-green-200">
                                            Correct Answer
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Retake & Release Section */}
              <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-4">
                <h4 className="font-bold text-slate-900 dark:text-white text-sm font-serif">
                  Official Decision & Release Controls
                </h4>

                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Examiner Assessment Notes (visible on official report):
                  </label>
                  <textarea
                    rows={3}
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    placeholder="Provide official feedback on candidate performance, recommendations, or grading comments..."
                    className="w-full p-2.5 text-xs sm:text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center justify-between gap-4 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex-wrap">
                  <label className="flex items-center gap-2 text-xs sm:text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={grantRetake}
                      onChange={(e) => setGrantRetake(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Grant retake privilege upon release</span>
                  </label>

                  {grantRetake && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Retakes to grant:</span>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={retakeCount}
                        onChange={(e) => setRetakeCount(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-center"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleSaveManualGrades}
                    disabled={savingGrades}
                  >
                    {savingGrades ? <Spinner size={14} /> : <Save size={14} />} Save Grades & Notes
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={handleRelease}
                      disabled={releasing}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {releasing ? <Spinner size={14} /> : <Send size={14} />} Release Score & Finalize
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-slate-500">
            No attempt details available.
          </div>
        )}
      </div>

      {/* Image Lightbox Modal */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-60 bg-black/85 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <img src={zoomedImage} alt="Zoomed view" className="max-w-full max-h-[85vh] rounded-lg shadow-2xl object-contain" />
            <button
              onClick={() => setZoomedImage(null)}
              className="absolute top-2 right-2 p-2 bg-slate-900/80 hover:bg-slate-900 text-white rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

