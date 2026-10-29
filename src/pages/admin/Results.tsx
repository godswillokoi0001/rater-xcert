import { useEffect, useState, useCallback } from 'react';
import { supabase, callAdminApi } from '@/lib/supabase';
import { RouteGuard, AdminLayout } from '@/components/layouts';
import { Card, Badge, Spinner, EmptyState, Button, Select } from '@/components/ui';
import type { AttemptWithDetails, Test, QuestionType, Answer } from '@/types';
import {
  BarChart3, Download, CheckCircle2, XCircle, TrendingUp, Eye, Send, Clock,
  FileText, X, ExternalLink, RotateCcw, Printer, Save, Award, Check, AlertCircle,
} from 'lucide-react';

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
    answers: Array<Answer>;
    review_status: string;
    admin_notes: string;
  };
  test_title: string;
  pass_mark: number;
  candidate_name: string;
  candidate_email: string;
  sections: Array<{ id: string; title: string; order_index: number }>;
  questions: Array<{
    id: string;
    section_id: string;
    question_image: string;
    instructions: string;
    order_index: number;
    question_type: QuestionType;
    question_text: string;
  }>;
  options: Array<{ id: string; question_id: string; option_label: string; option_text: string; is_correct: boolean }>;
  links: Array<{ id: string; question_id: string; url: string; label: string; order_index: number }>;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
  const [printingId, setPrintingId] = useState<string | null>(null);

  // Manual grading state: question_id -> { grade, score, feedback }
  const [manualGrades, setManualGrades] = useState<Record<string, { grade: 'correct' | 'incorrect' | 'partial'; score: number; feedback: string }>>({});
  const [savingGrades, setSavingGrades] = useState(false);
  const [gradeSavedToast, setGradeSavedToast] = useState(false);

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
    setGradeSavedToast(false);

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
      setReviewLoading(false);
    }
  };

  // Helper to calculate score dynamically considering manual text question scores
  const getCalculatedScore = (data: ReviewData, grades: typeof manualGrades) => {
    let autoCorrect = 0;
    let manualScoreSum = 0;

    data.questions.forEach((q) => {
      const candidateAnswer = data.attempt.answers.find((a) => a.question_id === q.id);
      const isText = q.question_type === 'text_short' || q.question_type === 'text_long';

      if (isText) {
        const mg = grades[q.id];
        if (mg) {
          manualScoreSum += mg.score;
        }
      } else if (q.question_type === 'multi_select') {
        const sIds = candidateAnswer?.selected_option_ids;
        const qOptions = data.options.filter((o) => o.question_id === q.id);
        const correctCount = qOptions.filter((o) => o.is_correct).length;
        const isCorrect = (sIds || []).length > 0 &&
          (sIds || []).every((id) => qOptions.find((o) => o.id === id)?.is_correct) &&
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

      // Merge manual grades into attempt's answers array
      const updatedAnswers: Answer[] = reviewData.questions.map((q) => {
        const existing = reviewData.attempt.answers.find((a) => a.question_id === q.id) || { question_id: q.id, selected_option_id: null };
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

      // Update attempt in Supabase
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

      // Update local state
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
      fetchAll();
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

    // Ensure manual grades are saved first
    const { finalScore, passOrFail, totalCorrectDisplay, totalQuestions } = getCalculatedScore(reviewData, manualGrades);
    const updatedAnswers: Answer[] = reviewData.questions.map((q) => {
      const existing = reviewData.attempt.answers.find((a) => a.question_id === q.id) || { question_id: q.id, selected_option_id: null };
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

    await supabase
      .from('attempts')
      .update({
        answers: updatedAnswers,
        score: finalScore,
        pass_or_fail: passOrFail,
        correct_answers: Math.round(totalCorrectDisplay),
        total_questions: totalQuestions,
      })
      .eq('id', reviewData.attempt.id);

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
      await fetchAll();
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
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setReleasing(false);
    }
  };

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

  // Requirement 4: Print results in PDF format (just the result, not the whole screen)
  const handlePrintResult = async (targetAttemptId: string) => {
    setPrintingId(targetAttemptId);
    let fullData: ReviewData | null = reviewData?.attempt.id === targetAttemptId ? reviewData : null;

    if (!fullData) {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) throw new Error('Not authenticated');
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api/review-attempt?id=${targetAttemptId}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
          }
        );
        fullData = await res.json();
      } catch (err) {
        alert('Failed to load assessment report for printing.');
        setPrintingId(null);
        return;
      }
    }

    if (!fullData || !fullData.attempt) {
      setPrintingId(null);
      return;
    }

    const printWin = window.open('', '_blank', 'width=900,height=1000');
    if (!printWin) {
      alert('Please allow popups in your browser to print the result report.');
      setPrintingId(null);
      return;
    }

    const isPass = fullData.attempt.pass_or_fail === 'pass';
    const submittedDate = fullData.attempt.submitted_at
      ? new Date(fullData.attempt.submitted_at).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'N/A';

    const questionsRows = fullData.questions.map((q, idx) => {
      const candidateAnswer = fullData!.attempt.answers.find((a) => a.question_id === q.id);
      const qOptions = fullData!.options.filter((o) => o.question_id === q.id);
      const isText = q.question_type === 'text_short' || q.question_type === 'text_long';

      let answerDisplay = 'No answer provided';
      let gradeLabel = 'Incorrect';
      let gradeColor = '#dc2626';

      if (isText) {
        answerDisplay = candidateAnswer?.text_answer || 'No answer submitted';
        const mg = candidateAnswer?.manual_grade;
        if (mg === 'correct') {
          gradeLabel = `Full Points (${candidateAnswer?.manual_score ?? 1.0} pt)`;
          gradeColor = '#16a34a';
        } else if (mg === 'partial') {
          gradeLabel = `Partial Credit (${candidateAnswer?.manual_score ?? 0.5} pt)`;
          gradeColor = '#d97706';
        } else if (mg === 'incorrect') {
          gradeLabel = '0 Points (Incorrect)';
          gradeColor = '#dc2626';
        } else {
          gradeLabel = 'Awaiting Manual Grade';
          gradeColor = '#d97706';
        }
      } else if (q.question_type === 'multi_select') {
        const sIds = candidateAnswer?.selected_option_ids || [];
        answerDisplay = sIds.map((id) => qOptions.find((o) => o.id === id)?.option_text || id).join(', ') || 'No option selected';
        const isCorrect = sIds.length > 0 &&
          sIds.every((id) => qOptions.find((o) => o.id === id)?.is_correct) &&
          sIds.length === qOptions.filter((o) => o.is_correct).length;
        gradeLabel = isCorrect ? 'Correct' : 'Incorrect';
        gradeColor = isCorrect ? '#16a34a' : '#dc2626';
      } else {
        const selected = qOptions.find((o) => o.id === candidateAnswer?.selected_option_id);
        answerDisplay = selected ? `${selected.option_label}. ${selected.option_text}` : 'No option selected';
        gradeLabel = selected?.is_correct ? 'Correct' : 'Incorrect';
        gradeColor = selected?.is_correct ? '#16a34a' : '#dc2626';
      }

      return `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px 8px; font-weight: 600; width: 35px; text-align: center; color: #475569; vertical-align: top;">${idx + 1}</td>
          <td style="padding: 10px 8px; vertical-align: top;">
            <div style="font-weight: 600; color: #0f172a; margin-bottom: 3px;">${escapeHtml(q.question_text || q.instructions || 'Question ' + (idx + 1))}</div>
            <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">${q.question_type.replace('_', ' ')}</div>
          </td>
          <td style="padding: 10px 8px; color: #334155; font-size: 13px; vertical-align: top; max-width: 300px; word-break: break-word;">
            ${escapeHtml(answerDisplay)}
            ${candidateAnswer?.manual_feedback ? `<div style="margin-top: 4px; font-size: 11px; color: #0369a1; font-style: italic;">Note: ${escapeHtml(candidateAnswer.manual_feedback)}</div>` : ''}
          </td>
          <td style="padding: 10px 8px; font-weight: bold; color: ${gradeColor}; font-size: 12px; text-align: right; vertical-align: top; white-space: nowrap;">
            ${gradeLabel}
          </td>
        </tr>
      `;
    }).join('');

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Assessment Result - ${escapeHtml(fullData.candidate_name)} - ${escapeHtml(fullData.test_title)}</title>
          <style>
            @page { size: A4; margin: 15mm; }
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
              color: #0f172a;
              margin: 0;
              padding: 24px;
              background: #ffffff;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .header-banner {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 2.5px solid #1e40af;
              padding-bottom: 16px;
              margin-bottom: 24px;
            }
            .logo-title { font-size: 24px; font-weight: bold; color: #1e40af; font-family: Georgia, serif; }
            .report-type { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 3px; }
            .result-pill {
              display: inline-block;
              padding: 8px 24px;
              border-radius: 9999px;
              font-size: 16px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              border: 2px solid ${isPass ? '#16a34a' : '#dc2626'};
              background: ${isPass ? '#f0fdf4' : '#fef2f2'};
              color: ${isPass ? '#15803d' : '#b91c1c'};
            }
            .candidate-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 12px;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              padding: 16px 20px;
              margin-bottom: 24px;
            }
            .field-label { font-size: 11px; text-transform: uppercase; font-weight: 600; color: #64748b; margin-bottom: 2px; }
            .field-value { font-size: 14px; font-weight: 600; color: #0f172a; }
            .metrics-box {
              display: flex;
              justify-content: space-around;
              background: #f1f5f9;
              border-radius: 12px;
              padding: 18px;
              margin-bottom: 24px;
              text-align: center;
            }
            .metric-num { font-size: 32px; font-weight: 800; line-height: 1; margin-bottom: 4px; }
            .notes-section {
              background: #eff6ff;
              border-left: 4px solid #2563eb;
              border-radius: 0 8px 8px 0;
              padding: 12px 16px;
              margin-bottom: 24px;
            }
            table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; margin-bottom: 30px; }
            th {
              background: #f8fafc;
              border-bottom: 2px solid #cbd5e1;
              text-align: left;
              padding: 10px 8px;
              font-size: 11px;
              text-transform: uppercase;
              color: #475569;
              letter-spacing: 0.05em;
            }
            .sign-row {
              display: flex;
              justify-content: space-between;
              margin-top: 40px;
              padding-top: 10px;
            }
            .sign-col { width: 220px; text-align: center; border-top: 1px dashed #64748b; padding-top: 6px; font-size: 12px; color: #475569; }
            .footer-row {
              border-top: 1px solid #e2e8f0;
              padding-top: 15px;
              margin-top: 30px;
              display: flex;
              justify-content: space-between;
              font-size: 11px;
              color: #94a3b8;
            }
          </style>
        </head>
        <body>
          <div class="header-banner">
            <div>
              <div class="logo-title">Rater X Certification System</div>
              <div class="report-type">Official Candidate Examination & Evaluation Report</div>
            </div>
            <div>
              <div class="result-pill">${isPass ? 'PASSED' : 'FAILED'}</div>
            </div>
          </div>

          <div class="candidate-grid">
            <div>
              <div class="field-label">Candidate Name</div>
              <div class="field-value">${escapeHtml(fullData.candidate_name)}</div>
            </div>
            <div>
              <div class="field-label">Candidate Email</div>
              <div class="field-value">${escapeHtml(fullData.candidate_email || 'N/A')}</div>
            </div>
            <div>
              <div class="field-label">Certification Exam</div>
              <div class="field-value">${escapeHtml(fullData.test_title)}</div>
            </div>
            <div>
              <div class="field-label">Date Submitted</div>
              <div class="field-value">${submittedDate}</div>
            </div>
          </div>

          <div class="metrics-box">
            <div>
              <div class="metric-num" style="color: ${isPass ? '#16a34a' : '#dc2626'};">${fullData.attempt.score}%</div>
              <div class="field-label">Final Score</div>
            </div>
            <div>
              <div class="metric-num" style="color: #334155;">${fullData.pass_mark}%</div>
              <div class="field-label">Passing Standard</div>
            </div>
            <div>
              <div class="metric-num" style="color: #334155;">${fullData.attempt.correct_answers} / ${fullData.attempt.total_questions}</div>
              <div class="field-label">Scored Questions</div>
            </div>
          </div>

          ${fullData.attempt.admin_notes ? `
            <div class="notes-section">
              <div class="field-label" style="color: #1e40af;">Official Examiner Notes</div>
              <div style="font-size: 13px; color: #1e293b; margin-top: 4px;">${escapeHtml(fullData.attempt.admin_notes)}</div>
            </div>
          ` : ''}

          <div style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: #334155; letter-spacing: 0.05em; margin-bottom: 8px;">
            Question Breakdown & Answers
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 35px; text-align: center;">#</th>
                <th>Question</th>
                <th>Candidate's Submitted Answer</th>
                <th style="text-align: right;">Result / Score</th>
              </tr>
            </thead>
            <tbody>
              ${questionsRows}
            </tbody>
          </table>

          <div class="sign-row">
            <div class="sign-col">Authorized Examiner Signature</div>
            <div class="sign-col">Official Date Verified</div>
          </div>

          <div class="footer-row">
            <span>Rater X Evaluation Platform • Secure Result Verification</span>
            <span>Document ID: ${fullData.attempt.id}</span>
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 300);
            };
          </script>
        </body>
      </html>
    `);
    printWin.document.close();
    setPrintingId(null);
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

  // Active review calculated metrics
  const activeCalc = reviewData ? getCalculatedScore(reviewData, manualGrades) : null;

  return (
    <RouteGuard roles={['admin', 'super_admin']}>
      <AdminLayout current="/admin/results">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-serif mb-1">Results & Reports</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Review candidate attempts, record manual grades, and export official reports</p>
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
              <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/40 flex items-center justify-center text-blue-700 dark:text-blue-300"><BarChart3 size={20} /></div>
              <div><p className="text-2xl font-bold text-slate-900 dark:text-white">{filtered.length}</p><p className="text-xs text-slate-500 dark:text-slate-400">Total Attempts</p></div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400"><TrendingUp size={20} /></div>
              <div><p className="text-2xl font-bold text-slate-900 dark:text-white">{avgScore}%</p><p className="text-xs text-slate-500 dark:text-slate-400">Average Score</p></div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-50 dark:bg-green-900/40 flex items-center justify-center text-green-600 dark:text-green-400"><CheckCircle2 size={20} /></div>
              <div><p className="text-2xl font-bold text-slate-900 dark:text-white">{passRate}%</p><p className="text-xs text-slate-500 dark:text-slate-400">Pass Rate</p></div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-900/40 flex items-center justify-center text-orange-600 dark:text-orange-400"><Clock size={20} /></div>
              <div><p className="text-2xl font-bold text-slate-900 dark:text-white">{pendingReviewCount}</p><p className="text-xs text-slate-500 dark:text-slate-400">Awaiting Review</p></div>
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
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Candidate</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Test</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider hidden sm:table-cell">Date</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Score</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Result</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Review Status</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-5 py-3.5 text-sm font-medium text-slate-900 dark:text-white">{a.candidate_name || 'Unknown'}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-600 dark:text-slate-300">{a.test_title || 'Unknown'}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 dark:text-slate-400 hidden sm:table-cell">
                        {a.submitted_at ? new Date(a.submitted_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-slate-700 dark:text-slate-300 font-medium">
                        {Number(a.score)}% <span className="text-slate-400 dark:text-slate-500 font-normal">({a.correct_answers}/{a.total_questions})</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {a.pass_or_fail === 'pass' ? (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400"><CheckCircle2 size={16} /> Pass</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600 dark:text-red-400"><XCircle size={16} /> Fail</span>
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
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {a.review_status !== 'released' ? (
                            <Button size="sm" variant="primary" onClick={() => openReview(a.id)}>
                              <Eye size={14} /> Review
                            </Button>
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => openReview(a.id)}>
                              <FileText size={14} /> View
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handlePrintResult(a.id)}
                            title="Print PDF Result Document"
                            disabled={printingId === a.id}
                          >
                            {printingId === a.id ? <Spinner size={14} /> : <Printer size={14} />}
                            <span className="hidden lg:inline">Print</span>
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => grantRetakeToAttempt(a)} title="Grant retake">
                            <RotateCcw size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Review & Manual Grading Modal */}
        {(reviewLoading || reviewData) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-y-auto border border-slate-200 dark:border-slate-800">
              {reviewLoading ? (
                <div className="flex justify-center items-center py-20"><Spinner size={32} /></div>
              ) : reviewData ? (
                <div>
                  {/* Modal Header */}
                  <div className="flex items-center justify-between p-5 sm:p-6 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-slate-900 z-20">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-xl font-bold font-serif text-slate-900 dark:text-white">Review & Grade Attempt</h2>
                        <Badge color={reviewData.attempt.review_status === 'released' ? 'green' : 'amber'}>
                          {reviewData.attempt.review_status}
                        </Badge>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {reviewData.candidate_name} ({reviewData.candidate_email || 'No email'}) • {reviewData.test_title}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handlePrintResult(reviewData.attempt.id)}
                        title="Print official result report as PDF"
                      >
                        <Printer size={15} /> Print PDF
                      </Button>
                      <button onClick={() => { setReviewData(null); setReleaseMsg(null); }} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                        <X size={22} />
                      </button>
                    </div>
                  </div>

                  {/* Score & Calculation Summary Bar */}
                  <div className="p-5 sm:p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                      <div className="p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                        <p className={`text-3xl font-extrabold ${activeCalc?.passOrFail === 'pass' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {activeCalc?.finalScore}%
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Evaluated Score</p>
                      </div>
                      <div className="p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                        <p className="text-3xl font-extrabold text-slate-900 dark:text-white">
                          {activeCalc?.totalCorrectDisplay} / {activeCalc?.totalQuestions}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Points Earned</p>
                      </div>
                      <div className="p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                        <p className={`text-3xl font-extrabold ${activeCalc?.passOrFail === 'pass' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {activeCalc?.passOrFail === 'pass' ? 'Pass' : 'Fail'}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Status</p>
                      </div>
                      <div className="p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                        <p className="text-3xl font-extrabold text-slate-900 dark:text-white">{reviewData.pass_mark}%</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">Passing Threshold</p>
                      </div>
                    </div>

                    {/* Manual Grade Quick Action Banner */}
                    <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900">
                      <div className="flex items-center gap-2 text-xs sm:text-sm text-blue-800 dark:text-blue-300">
                        <Award size={18} className="shrink-0 text-blue-600 dark:text-blue-400" />
                        <span>Manual grading enabled: Score short and long answers below. Click save to record candidate grades.</span>
                      </div>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={handleSaveManualGrades}
                        disabled={savingGrades}
                        className="shrink-0"
                      >
                        {savingGrades ? <Spinner size={14} /> : <Save size={14} />}
                        Save Evaluation
                      </Button>
                    </div>

                    {gradeSavedToast && (
                      <div className="mt-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-300 flex items-center gap-2 animate-fade-in">
                        <CheckCircle2 size={16} /> Evaluation saved successfully! Candidate score updated.
                      </div>
                    )}
                  </div>

                  {/* Candidate Answers & Questions List */}
                  <div className="p-5 sm:p-6 space-y-6">
                    <h3 className="font-semibold text-slate-900 dark:text-white">Exam Questions & Evaluation</h3>
                    {reviewData.sections.map((section) => {
                      const sectionQuestions = reviewData.questions.filter((q) => q.section_id === section.id);
                      return (
                        <div key={section.id} className="space-y-4">
                          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 pb-2 border-b border-slate-200 dark:border-slate-800">
                            {section.title}
                          </h4>
                          {sectionQuestions.map((q, qi) => {
                            const qOptions = reviewData.options.filter((o) => o.question_id === q.id);
                            const candidateAnswer = reviewData.attempt.answers.find((a) => a.question_id === q.id);
                            const isMultiSelect = q.question_type === 'multi_select';
                            const isTextQ = q.question_type === 'text_short' || q.question_type === 'text_long';
                            const selectedOption = qOptions.find((o) => o.id === candidateAnswer?.selected_option_id);
                            const selectedIds = candidateAnswer?.selected_option_ids;
                            const textAnswer = candidateAnswer?.text_answer;

                            // Evaluation status
                            const currentMg = manualGrades[q.id];
                            const textGrade = currentMg?.grade || (candidateAnswer?.manual_grade);
                            const isCorrect = isTextQ
                              ? textGrade === 'correct'
                              : isMultiSelect
                              ? (selectedIds || []).length > 0 && (selectedIds || []).every(id => qOptions.find(o => o.id === id)?.is_correct) && (selectedIds || []).length === qOptions.filter(o => o.is_correct).length
                              : selectedOption?.is_correct || false;

                            return (
                              <div key={q.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 transition-colors">
                                <div className="flex items-start gap-3 mb-3">
                                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold flex items-center justify-center">
                                    {qi + 1}
                                  </span>
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-xs px-2 py-0.5 rounded font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 capitalize">
                                        {q.question_type.replace('_', ' ')}
                                      </span>
                                    </div>
                                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
                                      {q.question_text || q.instructions || `Question ${qi + 1}`}
                                    </p>
                                    {q.question_image && (
                                      <img src={q.question_image} alt="Question" className="max-h-44 rounded-lg border border-slate-200 dark:border-slate-700 mb-2 object-contain" />
                                    )}
                                    {(reviewData.links || []).filter((l) => l.question_id === q.id).length > 0 && (
                                      <div className="flex flex-wrap gap-2 mb-2">
                                        {(reviewData.links || []).filter((l) => l.question_id === q.id).map((link) => (
                                          <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium">
                                            <ExternalLink size={12} /> {link.label || link.url}
                                          </a>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* Right status badge */}
                                  {isTextQ ? (
                                    <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${
                                      textGrade === 'correct'
                                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                                        : textGrade === 'partial'
                                        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                                        : textGrade === 'incorrect'
                                        ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-amber-300 dark:border-amber-800'
                                    }`}>
                                      {textGrade === 'correct' ? 'Full Points (1.0)' : textGrade === 'partial' ? 'Partial Credit' : textGrade === 'incorrect' ? '0 Points' : 'Needs Grade'}
                                    </span>
                                  ) : (
                                    <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${isCorrect ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'}`}>
                                      {isCorrect ? 'Correct' : 'Incorrect'}
                                    </span>
                                  )}
                                </div>

                                {/* Answers Section & Manual Grade Controls */}
                                <div className="ml-9 space-y-3">
                                  {isTextQ ? (
                                    <div className="space-y-3">
                                      {/* Candidate text answer display */}
                                      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-sm">
                                        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                                          Candidate's Submitted Answer:
                                        </div>
                                        <p className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap">
                                          {textAnswer ? textAnswer : <span className="text-slate-400 italic">No answer was submitted</span>}
                                        </p>
                                      </div>

                                      {/* Requirement 3: Admin Manual Recording Controls */}
                                      <div className="p-3.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 space-y-2.5">
                                        <div className="flex items-center justify-between flex-wrap gap-2">
                                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                            Admin Evaluation & Score:
                                          </span>
                                          <div className="inline-flex items-center gap-1.5">
                                            <button
                                              type="button"
                                              onClick={() => handleSetManualGrade(q.id, 'correct', 1.0)}
                                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                                                textGrade === 'correct'
                                                  ? 'bg-green-600 text-white shadow-sm'
                                                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-green-50'
                                              }`}
                                            >
                                              <Check size={13} /> Full Points (1.0)
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleSetManualGrade(q.id, 'partial', 0.5)}
                                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                                                textGrade === 'partial'
                                                  ? 'bg-amber-600 text-white shadow-sm'
                                                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-amber-50'
                                              }`}
                                            >
                                              Partial (0.5)
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleSetManualGrade(q.id, 'incorrect', 0.0)}
                                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                                                textGrade === 'incorrect'
                                                  ? 'bg-red-600 text-white shadow-sm'
                                                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-red-50'
                                              }`}
                                            >
                                              <X size={13} /> 0 Points
                                            </button>
                                          </div>
                                        </div>

                                        {/* Examiner feedback for this question */}
                                        <div>
                                          <input
                                            type="text"
                                            value={currentMg?.feedback !== undefined ? currentMg.feedback : (candidateAnswer?.manual_feedback || '')}
                                            onChange={(e) => handleSetManualGrade(q.id, textGrade || 'correct', currentMg?.score, e.target.value)}
                                            placeholder="Optional examiner feedback / notes on this response..."
                                            className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                          />
                                        </div>
                                      </div>
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
                                            className={`flex items-center gap-2 text-sm px-3.5 py-2.5 rounded-lg border transition-colors ${
                                              opt.is_correct
                                                ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900 text-green-800 dark:text-green-300'
                                                : isSelected
                                                ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'
                                                : 'border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                                            }`}
                                          >
                                            <span className="font-bold w-6">{opt.option_label}.</span>
                                            <span className="flex-1">{opt.option_text}</span>
                                            {opt.is_correct && <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />}
                                            {isSelected && !opt.is_correct && <XCircle size={16} className="text-red-600 dark:text-red-400" />}
                                            {isSelected && <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 ml-2">Selected</span>}
                                          </div>
                                        );
                                      })}
                                      {!candidateAnswer?.selected_option_id && !(selectedIds && selectedIds.length > 0) && (
                                        <p className="text-xs text-slate-400 italic">No option was selected</p>
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

                  {/* Release & Finalize Controls */}
                  <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                    {releaseMsg && (
                      <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-300">
                        {releaseMsg}
                      </div>
                    )}
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">
                          Official Admin Notes (printed on report & visible to candidate)
                        </label>
                        <textarea
                          value={adminNotes}
                          onChange={(e) => setAdminNotes(e.target.value)}
                          rows={2}
                          placeholder="Add any evaluation summary or notes..."
                          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {reviewData.attempt.review_status !== 'released' && (
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={grantRetake}
                              onChange={(e) => setGrantRetake(e.target.checked)}
                              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            Grant retake permission for this candidate
                          </label>
                          {grantRetake && (
                            <div className="ml-6 flex items-center gap-2">
                              <label className="text-sm text-slate-600 dark:text-slate-400">Number of retakes:</label>
                              <input
                                type="number"
                                min={1}
                                max={10}
                                value={retakeCount}
                                onChange={(e) => setRetakeCount(Math.max(1, Number(e.target.value)))}
                                className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg text-sm"
                              />
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-2 flex-wrap gap-3">
                        <Button
                          variant="secondary"
                          onClick={() => handlePrintResult(reviewData.attempt.id)}
                        >
                          <Printer size={16} /> Print Result (PDF)
                        </Button>
                        <div className="flex items-center gap-2">
                          <Button variant="secondary" onClick={() => { setReviewData(null); setReleaseMsg(null); }}>
                            Close
                          </Button>
                          <Button variant="secondary" onClick={handleSaveManualGrades} disabled={savingGrades}>
                            {savingGrades ? <Spinner size={16} /> : <Save size={16} />} Save Grades
                          </Button>
                          {reviewData.attempt.review_status !== 'released' && (
                            <Button onClick={handleRelease} disabled={releasing}>
                              {releasing ? <Spinner size={16} /> : <Send size={16} />} Release Score & Notify
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </AdminLayout>
    </RouteGuard>
  );
}
