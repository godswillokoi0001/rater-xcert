import { supabase } from '@/lib/supabase';
import type { ReviewData, QuestionType, Answer } from '@/types';

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function printAttemptPdf(attemptId: string, initialReviewData?: ReviewData | null): Promise<void> {
  let fullData: ReviewData | null = initialReviewData?.attempt?.id === attemptId ? initialReviewData : null;

  if (!fullData) {
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api/review-attempt?id=${attemptId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );
      if (res.ok) {
        fullData = await res.json();
      }
    } catch {
      // Fallback: Query directly from Supabase client
    }

    if (!fullData) {
      try {
        const { data: attempt } = await supabase.from('attempts').select('*').eq('id', attemptId).single();
        if (!attempt) throw new Error('Attempt not found');

        const [{ data: test }, { data: candidateProfile }, { data: sections }] = await Promise.all([
          supabase.from('tests').select('title, pass_mark').eq('id', attempt.test_id).single(),
          supabase.from('profiles').select('name, email').eq('id', attempt.candidate_id).single(),
          supabase.from('sections').select('*').eq('test_id', attempt.test_id).order('order_index', { ascending: true }),
        ]);

        const sectionIds = (sections || []).map((s: { id: string }) => s.id);
        const { data: questions } = await supabase.from('questions').select('*').in('section_id', sectionIds).order('order_index', { ascending: true });
        const questionIds = (questions || []).map((q: { id: string }) => q.id);

        const [{ data: options }, { data: links }] = await Promise.all([
          questionIds.length > 0 ? supabase.from('question_options').select('*').in('question_id', questionIds) : { data: [] },
          questionIds.length > 0 ? supabase.from('question_links').select('*').in('question_id', questionIds) : { data: [] },
        ]);

        fullData = {
          attempt,
          test_title: test?.title || 'Assessment',
          pass_mark: test?.pass_mark ?? 70,
          candidate_name: candidateProfile?.name || 'Candidate',
          candidate_email: candidateProfile?.email || '',
          sections: sections || [],
          questions: questions || [],
          options: options || [],
          links: links || [],
        };
      } catch (err) {
        alert('Failed to load assessment report for printing.');
        return;
      }
    }
  }

  if (!fullData || !fullData.attempt) {
    alert('Assessment data unavailable for printing.');
    return;
  }

  const printWin = window.open('', '_blank', 'width=900,height=1000');
  if (!printWin) {
    alert('Please allow popups in your browser to print the result report.');
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

  const questionsRows = (fullData.questions || []).map((q, idx) => {
    const candidateAnswer = fullData!.attempt.answers?.find((a: Answer) => a.question_id === q.id);
    const qOptions = (fullData!.options || []).filter((o) => o.question_id === q.id);
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
      answerDisplay = sIds.map((id: string) => qOptions.find((o) => o.id === id)?.option_text || id).join(', ') || 'No option selected';
      const isCorrect = sIds.length > 0 &&
        sIds.every((id: string) => qOptions.find((o) => o.id === id)?.is_correct) &&
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
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 2px solid #0284c7;
            padding-bottom: 16px;
            margin-bottom: 20px;
          }
          .title { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0; }
          .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
          .badge {
            display: inline-block;
            padding: 6px 14px;
            border-radius: 9999px;
            font-size: 13px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .badge-pass { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
          .badge-fail { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
          .meta-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 14px 16px;
            margin-bottom: 24px;
          }
          .meta-item { font-size: 13px; }
          .meta-label { color: #64748b; font-weight: 500; margin-bottom: 2px; }
          .meta-val { color: #0f172a; font-weight: 700; font-size: 14px; }
          .score-banner {
            display: flex;
            align-items: center;
            justify-content: space-around;
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 8px;
            padding: 14px;
            margin-bottom: 24px;
          }
          .score-banner.fail {
            background: #fef2f2;
            border-color: #fecaca;
          }
          .score-box { text-align: center; }
          .score-val { font-size: 28px; font-weight: 800; color: #0f172a; }
          .score-label { font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
          th {
            background: #f1f5f9;
            color: #475569;
            text-align: left;
            padding: 10px 8px;
            font-weight: 700;
            border-bottom: 2px solid #cbd5e1;
            font-size: 12px;
            text-transform: uppercase;
          }
          .sign-row {
            margin-top: 40px;
            display: flex;
            justify-content: space-between;
            padding-top: 20px;
          }
          .sign-col {
            border-top: 1px solid #94a3b8;
            width: 200px;
            text-align: center;
            font-size: 11px;
            color: #64748b;
            padding-top: 6px;
          }
          .footer-row {
            margin-top: 30px;
            padding-top: 12px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: #94a3b8;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1 class="title">Rater-X Evaluation Report</h1>
            <div class="subtitle">Official Assessment Verification & Accreditation Record</div>
          </div>
          <div>
            <span class="badge ${isPass ? 'badge-pass' : 'badge-fail'}">
              ${isPass ? 'Passed' : 'Failed'}
            </span>
          </div>
        </div>

        <div class="meta-grid">
          <div class="meta-item">
            <div class="meta-label">Candidate / Worker Name</div>
            <div class="meta-val">${escapeHtml(fullData.candidate_name)}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Evaluation Assessment</div>
            <div class="meta-val">${escapeHtml(fullData.test_title)}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Candidate Email</div>
            <div class="meta-val">${escapeHtml(fullData.candidate_email || 'N/A')}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Date Submitted</div>
            <div class="meta-val">${submittedDate}</div>
          </div>
        </div>

        <div class="score-banner ${isPass ? 'pass' : 'fail'}">
          <div class="score-box">
            <div class="score-val">${Number(fullData.attempt.score)}%</div>
            <div class="score-label">Final Grade</div>
          </div>
          <div class="score-box">
            <div class="score-val">${fullData.attempt.correct_answers} / ${fullData.attempt.total_questions}</div>
            <div class="score-label">Points Earned</div>
          </div>
          <div class="score-box">
            <div class="score-val">${fullData.pass_mark}%</div>
            <div class="score-label">Passing Standard</div>
          </div>
          <div class="score-box">
            <div class="score-val" style="color: ${isPass ? '#16a34a' : '#dc2626'}">${isPass ? 'PASS' : 'FAIL'}</div>
            <div class="score-label">Result Status</div>
          </div>
        </div>

        ${fullData.attempt.admin_notes ? `
          <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px;">
            <strong style="color: #1e40af; display: block; margin-bottom: 4px;">Examiner Evaluation Feedback:</strong>
            <span style="color: #1e3a8a;">${escapeHtml(fullData.attempt.admin_notes)}</span>
          </div>
        ` : ''}

        <div style="font-weight: 700; font-size: 15px; margin-bottom: 8px; color: #0f172a;">Itemized Section & Question Performance</div>
        <table>
          <thead>
            <tr>
              <th style="width: 35px; text-align: center;">#</th>
              <th>Question & Prompt</th>
              <th>Submitted Response</th>
              <th style="text-align: right;">Status / Points</th>
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
}
