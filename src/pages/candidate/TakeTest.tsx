import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { Button, Card, Badge, Spinner } from '@/components/ui';
import type { Test, Section, Question, Option, Answer, QuestionType, QuestionLink } from '@/types';
import {
  Clock, ChevronLeft, ChevronRight, ExternalLink,
  AlertTriangle, ZoomIn, ZoomOut, X, FileText, Lock, Trophy, XCircle,
} from 'lucide-react';

interface TestData {
  test: Test;
  sections: Section[];
  questions: Record<string, Question[]>;
  options: Record<string, Option[]>;
  links: Record<string, QuestionLink[]>;
}

interface AnswerState {
  selectedOptionId?: string | null;
  selectedOptionIds?: string[];
  textAnswer?: string;
}

function getExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/\//, '')}`;

  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function TestTakingPage({ testId }: { testId: string }) {
  const { user } = useAuth();
  const [data, setData] = useState<TestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [sectionStartTimes, setSectionStartTimes] = useState<Record<string, number>>({});
  const [sectionTimeUsed, setSectionTimeUsed] = useState<Record<string, number>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ review_status: string; review_mode?: string; score?: number; pass_or_fail?: string; correct_answers?: number; total_questions?: number } | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [lockedSections, setLockedSections] = useState<Set<number>>(new Set());
  const [showZoom, setShowZoom] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const startedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: test } = await supabase.from('tests').select('*').eq('id', testId).maybeSingle();
      if (!test) { navigate('/candidate'); return; }
      if (test.status !== 'published') { navigate('/candidate'); return; }

      const { data: canTake, error: canTakeErr } = await supabase.rpc('can_take_test', { p_test_id: testId });
      if (canTakeErr || (canTake && !canTake.can_take)) {
        setBlockedReason(canTake?.reason || 'You are not allowed to take this test at this time.');
        setLoading(false);
        return;
      }

      const { data: sections } = await supabase
        .from('sections').select('*').eq('test_id', testId).order('order_index', { ascending: true });
      if (!sections || sections.length === 0) { navigate('/candidate'); return; }

      const sectionIds = sections.map((s) => s.id);
      const { data: questions } = await supabase
        .from('questions').select('*').in('section_id', sectionIds).order('order_index', { ascending: true });

      const questionIds = (questions || []).map((q) => q.id);
      let optionsData: Option[] = [];
      let linksData: QuestionLink[] = [];
      if (questionIds.length > 0) {
        const [optsRes, linksRes] = await Promise.all([
          supabase.from('options').select('*').in('question_id', questionIds),
          supabase.from('question_links').select('*').in('question_id', questionIds).order('order_index', { ascending: true }),
        ]);
        optionsData = (optsRes.data || []) as Option[];
        linksData = (linksRes.data || []) as QuestionLink[];
      }

      const questionsBySection: Record<string, Question[]> = {};
      (questions || []).forEach((q) => {
        if (!questionsBySection[q.section_id]) questionsBySection[q.section_id] = [];
        questionsBySection[q.section_id].push(q as Question);
      });

      const optionsByQuestion: Record<string, Option[]> = {};
      optionsData.forEach((o) => {
        if (!optionsByQuestion[o.question_id]) optionsByQuestion[o.question_id] = [];
        optionsByQuestion[o.question_id].push(o);
      });

      const linksByQuestion: Record<string, QuestionLink[]> = {};
      linksData.forEach((l) => {
        if (!linksByQuestion[l.question_id]) linksByQuestion[l.question_id] = [];
        linksByQuestion[l.question_id].push(l);
      });

      setData({ test: test as Test, sections: sections as Section[], questions: questionsBySection, options: optionsByQuestion, links: linksByQuestion });
      const startTime = Date.now();
      startedAtRef.current = startTime;
      setSectionStartTimes({ [sections[0].id]: startTime });
      setTimeLeft(sections[0].timer_minutes * 60);
      setLoading(false);
    })();
  }, [testId, user]);

  useEffect(() => {
    if (!data || submitting || result) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { handleSectionTimeout(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [data, submitting, result, currentSectionIdx]);

  const handleSectionTimeout = useCallback(() => {
    if (!data) return;
    const section = data.sections[currentSectionIdx];
    if (!section) return;
    const elapsed = Math.floor((Date.now() - (sectionStartTimes[section.id] || Date.now())) / 1000);
    setSectionTimeUsed((prev) => ({ ...prev, [section.id]: elapsed }));
    setLockedSections((prev) => new Set(prev).add(currentSectionIdx));
    if (currentSectionIdx < data.sections.length - 1) {
      const nextIdx = currentSectionIdx + 1;
      const nextSection = data.sections[nextIdx];
      setCurrentSectionIdx(nextIdx);
      setCurrentQuestionIdx(0);
      setSectionStartTimes((prev) => ({ ...prev, [nextSection.id]: Date.now() }));
      setTimeLeft(nextSection.timer_minutes * 60);
    } else {
      submitTest();
    }
  }, [data, currentSectionIdx, sectionStartTimes]);

  const buildAnswerPayload = (): Answer[] => {
    if (!data) return [];
    const allAnswers: Answer[] = [];
    data.sections.forEach((section) => {
      (data.questions[section.id] || []).forEach((q) => {
        const ans = answers[q.id];
        const answer: Answer = { question_id: q.id, selected_option_id: null };
        if (ans) {
          if (q.question_type === 'multi_select') {
            answer.selected_option_ids = ans.selectedOptionIds || [];
          } else if (q.question_type === 'text_short' || q.question_type === 'text_long') {
            answer.text_answer = ans.textAnswer || '';
          } else {
            answer.selected_option_id = ans.selectedOptionId || null;
          }
        }
        allAnswers.push(answer);
      });
    });
    return allAnswers;
  };

  const submitTest = useCallback(async () => {
    if (!data || !user || submitting) return;
    setSubmitting(true);
    try {
      const allAnswers = buildAnswerPayload();
      const finalTimeUsed: Record<string, number> = { ...sectionTimeUsed };
      data.sections.forEach((section) => {
        if (!finalTimeUsed[section.id]) {
          finalTimeUsed[section.id] = Math.floor((Date.now() - (sectionStartTimes[section.id] || Date.now())) / 1000);
        }
      });
      const { data: resultData, error } = await supabase.rpc('submit_attempt', {
        p_test_id: testId, p_answers: allAnswers, p_per_section_time_used: finalTimeUsed,
      });
      if (error) throw error;
      setResult({
        review_status: resultData.review_status || 'pending_review',
        review_mode: resultData.review_mode,
        score: resultData.score,
        pass_or_fail: resultData.pass_or_fail,
        correct_answers: resultData.correct_answers,
        total_questions: resultData.total_questions,
      });

      // Trigger notification email to super admin
      try {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification-email`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'test_submitted',
            testId,
            testTitle: data.test.title,
            candidateName: user.user_metadata?.name || user.email,
            candidateEmail: user.email,
          }),
        });
      } catch {
        // Email failure should not block the user
      }
    } catch (err) {
      console.error('Submit error:', err);
      alert((err as { message?: string })?.message || 'Failed to submit test. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [data, user, answers, sectionTimeUsed, sectionStartTimes, testId, submitting]);

  const goToNextSection = () => {
    if (!data) return;
    const section = data.sections[currentSectionIdx];
    const elapsed = Math.floor((Date.now() - (sectionStartTimes[section.id] || Date.now())) / 1000);
    setSectionTimeUsed((prev) => ({ ...prev, [section.id]: elapsed }));
    setLockedSections((prev) => new Set(prev).add(currentSectionIdx));
    if (currentSectionIdx < data.sections.length - 1) {
      const nextIdx = currentSectionIdx + 1;
      const nextSection = data.sections[nextIdx];
      setCurrentSectionIdx(nextIdx);
      setCurrentQuestionIdx(0);
      setSectionStartTimes((prev) => ({ ...prev, [nextSection.id]: Date.now() }));
      setTimeLeft(nextSection.timer_minutes * 60);
    } else {
      submitTest();
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const hasAnswer = (qId: string, qType: QuestionType): boolean => {
    const ans = answers[qId];
    if (!ans) return false;
    if (qType === 'multi_select') return (ans.selectedOptionIds || []).length > 0;
    if (qType === 'text_short' || qType === 'text_long') return (ans.textAnswer || '').trim().length > 0;
    return !!ans.selectedOptionId;
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Spinner size={32} /></div>;

  if (blockedReason) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-lg w-full p-8 text-center animate-scale-in">
          <div className="w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center bg-amber-100 text-amber-600"><Clock size={40} /></div>
          <h1 className="text-2xl font-bold text-slate-900 font-serif mb-2">Test Not Available</h1>
          <p className="text-slate-600 mb-6">{blockedReason}</p>
          <Button onClick={() => navigate('/candidate')} size="lg" className="w-full">Back to Dashboard</Button>
        </Card>
      </div>
    );
  }

  if (result) {
    const isReleased = result.review_status === 'released';
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <Card className="max-w-lg w-full p-8 text-center animate-scale-in">
          <div className={`w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center ${isReleased ? (result.pass_or_fail === 'pass' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600') : 'bg-amber-100 text-amber-600'}`}>
            {isReleased ? (result.pass_or_fail === 'pass' ? <Trophy size={40} /> : <XCircle size={40} />) : <Clock size={40} />}
          </div>
          <h1 className="text-2xl font-bold text-slate-900 font-serif mb-2">Test Submitted Successfully</h1>
          {isReleased ? (
            <>
              <p className="text-slate-600 mb-6">Here are your results:</p>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="p-4 rounded-xl bg-slate-50">
                  <p className="text-3xl font-bold text-slate-900">{result.score}%</p>
                  <p className="text-xs text-slate-500 mt-1">Score</p>
                </div>
                <div className="p-4 rounded-xl bg-slate-50">
                  <p className="text-3xl font-bold text-slate-900">{result.correct_answers}/{result.total_questions}</p>
                  <p className="text-xs text-slate-500 mt-1">Correct</p>
                </div>
                <div className={`p-4 rounded-xl ${result.pass_or_fail === 'pass' ? 'bg-green-50' : 'bg-red-50'}`}>
                  <p className={`text-3xl font-bold ${result.pass_or_fail === 'pass' ? 'text-green-600' : 'text-red-600'}`}>{result.pass_or_fail === 'pass' ? 'Pass' : 'Fail'}</p>
                  <p className="text-xs text-slate-500 mt-1">Result</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-slate-600 mb-2">Your answers have been recorded and sent for review.</p>
              <p className="text-slate-500 text-sm mb-6">Your score will be available on your dashboard once an administrator reviews and releases your results. You will also receive an email notification.</p>
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 mb-6">
                <p className="text-sm text-amber-700 font-medium">Status: Awaiting Admin Review</p>
              </div>
            </>
          )}
          <Button onClick={() => navigate('/candidate')} size="lg" className="w-full">Back to Dashboard</Button>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const section = data.sections[currentSectionIdx];
  const questions = data.questions[section.id] || [];
  const question = questions[currentQuestionIdx];
  const options = question ? (data.options[question.id] || []) : [];
  const questionLinks = question ? (data.links[question.id] || []) : [];
  const isUrgent = timeLeft <= 30 && timeLeft > 0;
  const isLocked = lockedSections.has(currentSectionIdx);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-700 flex items-center justify-center text-white"><FileText size={16} /></div>
            <div>
              <h1 className="text-sm font-semibold text-slate-900">{data.test.title}</h1>
              <p className="text-xs text-slate-500">{section.title}</p>
            </div>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg font-mono font-bold text-lg ${isUrgent ? 'bg-red-50 text-red-600 timer-urgent' : 'bg-slate-100 text-slate-700'}`}>
            <Clock size={20} />{formatTime(timeLeft)}
          </div>
        </div>
      </div>

      {/* Section progress */}
      <div className="max-w-5xl mx-auto px-6 pt-4">
        <div className="flex items-center gap-2 mb-4 overflow-x-auto">
          {data.sections.map((s, i) => {
            const isCurrent = i === currentSectionIdx;
            const isPast = lockedSections.has(i);
            return (
              <div key={s.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${isCurrent ? 'bg-blue-700 text-white' : isPast ? 'bg-slate-200 text-slate-500' : 'bg-slate-100 text-slate-600'}`}>
                {isPast && <Lock size={12} />} Section {i + 1}: {s.title}
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-5xl mx-auto px-6 py-6">
        {isLocked ? (
          <Card className="p-8 text-center">
            <Lock size={32} className="mx-auto text-slate-400 mb-3" />
            <p className="text-slate-600">This section has been locked.</p>
          </Card>
        ) : question ? (
          <>
            {section.instructions && currentQuestionIdx === 0 && (
              <Card className="p-4 mb-4 bg-blue-50/50 border-blue-100">
                <p className="text-sm text-slate-700">{section.instructions}</p>
              </Card>
            )}

            <Card className="p-6 mb-4">
              <div className="flex items-center justify-between mb-4">
                <Badge color="blue">Question {currentQuestionIdx + 1} of {questions.length}</Badge>
                {(questionLinks.length > 0 || getExternalUrl(question.external_link)) && (
                  <div className="flex items-center gap-3 flex-wrap">
                    {questionLinks.map((link) => {
                      const href = getExternalUrl(link.url);
                      if (!href) return null;
                      return (
                        <a key={link.id} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
                          <ExternalLink size={14} /> {link.label || (() => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return 'Link'; } })()}
                        </a>
                      );
                    })}
                    {questionLinks.length === 0 && getExternalUrl(question.external_link) && (
                      <a href={getExternalUrl(question.external_link) as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
                        <ExternalLink size={14} /> Open Reference Link
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Question text */}
              {question.question_text && (
                <p className="text-base font-medium text-slate-900 mb-4">{question.question_text}</p>
              )}

              {/* Question image */}
              {question.question_image && (
                <div className="mb-4">
                  <button onClick={() => { setShowZoom(true); setZoomLevel(1); }} className="block w-full rounded-lg overflow-hidden border border-slate-200 hover:border-blue-300 transition-colors group relative">
                    <img src={question.question_image} alt="Question" className="w-full max-h-96 object-contain bg-slate-50" />
                    <div className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/10 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 flex items-center gap-1.5"><ZoomIn size={14} /> Click to zoom</span>
                    </div>
                  </button>
                </div>
              )}

              {/* Instructions */}
              {question.instructions && (
                <div className="mb-4 p-3 rounded-lg bg-slate-50">
                  <p className="text-sm text-slate-700">{question.instructions}</p>
                </div>
              )}

              {/* Render by question type */}
              <QuestionInput
                question={question}
                options={options}
                answer={answers[question.id] || {}}
                onChange={(ans) => setAnswers((prev) => ({ ...prev, [question.id]: ans }))}
              />
            </Card>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <Button variant="secondary" disabled={currentQuestionIdx === 0} onClick={() => setCurrentQuestionIdx((i) => Math.max(0, i - 1))}>
                <ChevronLeft size={16} /> Previous
              </Button>
              <div className="flex items-center gap-1.5">
                {questions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrentQuestionIdx(i)}
                    className={`w-2.5 h-2.5 rounded-full transition-colors ${i === currentQuestionIdx ? 'bg-blue-600' : hasAnswer(q.id, q.question_type) ? 'bg-blue-300' : 'bg-slate-300'}`}
                  />
                ))}
              </div>
              {currentQuestionIdx < questions.length - 1 ? (
                <Button onClick={() => setCurrentQuestionIdx((i) => i + 1)}>Next <ChevronRight size={16} /></Button>
              ) : currentSectionIdx < data.sections.length - 1 ? (
                <Button variant="success" onClick={goToNextSection}>Complete Section <ChevronRight size={16} /></Button>
              ) : (
                <Button variant="success" disabled={submitting} onClick={submitTest}>{submitting ? <Spinner /> : 'Submit Test'}</Button>
              )}
            </div>
          </>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-slate-600">No questions in this section.</p>
            {currentSectionIdx < data.sections.length - 1 && <Button className="mt-4" onClick={goToNextSection}>Go to Next Section</Button>}
          </Card>
        )}
      </div>

      {/* Zoom modal */}
      {showZoom && question?.question_image && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4" onClick={() => setShowZoom(false)}>
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="absolute top-4 right-4 z-10 flex gap-2">
              <button onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))} className="w-10 h-10 rounded-lg bg-white/90 flex items-center justify-center text-slate-700 hover:bg-white"><ZoomIn size={20} /></button>
              <button onClick={() => setZoomLevel((z) => Math.max(1, z - 0.25))} className="w-10 h-10 rounded-lg bg-white/90 flex items-center justify-center text-slate-700 hover:bg-white"><ZoomOut size={20} /></button>
              <button onClick={() => setShowZoom(false)} className="w-10 h-10 rounded-lg bg-white/90 flex items-center justify-center text-slate-700 hover:bg-white"><X size={20} /></button>
            </div>
            <div className="overflow-auto max-h-[90vh] rounded-lg">
              <img src={question.question_image} alt="Question (zoomed)" style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }} className="max-w-none" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionInput({ question, options, answer, onChange }: {
  question: Question; options: Option[]; answer: AnswerState; onChange: (a: AnswerState) => void;
}) {
  const qType = question.question_type;

  if (qType === 'single_choice' || qType === 'dropdown') {
    if (qType === 'dropdown') {
      return (
        <div>
          <select
            value={answer.selectedOptionId || ''}
            onChange={(e) => onChange({ selectedOptionId: e.target.value || null })}
            className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg text-sm text-slate-800 bg-white focus:outline-none focus:border-blue-500 transition-colors"
          >
            <option value="">Select an answer...</option>
            {options.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.option_label}. {opt.option_text}</option>
            ))}
          </select>
        </div>
      );
    }
    return (
      <div className="space-y-2.5">
        {options.map((opt) => {
          const selected = answer.selectedOptionId === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onChange({ selectedOptionId: opt.id })}
              className={`w-full flex items-center gap-3 p-3.5 rounded-lg border-2 text-left transition-all ${selected ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
            >
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${selected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {opt.option_label}
              </span>
              <span className="text-sm text-slate-800">{opt.option_text}</span>
            </button>
          );
        })}
      </div>
    );
  }

  if (qType === 'multi_select') {
    const selectedIds = answer.selectedOptionIds || [];
    const toggleOption = (optId: string) => {
      const next = selectedIds.includes(optId) ? selectedIds.filter((id) => id !== optId) : [...selectedIds, optId];
      onChange({ selectedOptionIds: next });
    };
    return (
      <div>
        {question.min_selections && (
          <p className="text-xs text-slate-500 mb-2">
            Select {question.min_selections}{question.max_selections ? ` to ${question.max_selections}` : ' or more'} options
          </p>
        )}
        <div className="space-y-2.5">
          {options.map((opt) => {
            const selected = selectedIds.includes(opt.id);
            return (
              <button
                key={opt.id}
                onClick={() => toggleOption(opt.id)}
                className={`w-full flex items-center gap-3 p-3.5 rounded-lg border-2 text-left transition-all ${selected ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
              >
                <span className={`w-7 h-7 rounded flex items-center justify-center text-sm font-bold shrink-0 ${selected ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {selected ? '✓' : opt.option_label}
                </span>
                <span className="text-sm text-slate-800">{opt.option_text}</span>
              </button>
            );
          })}
        </div>
        {question.min_selections && selectedIds.length < question.min_selections && selectedIds.length > 0 && (
          <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
            <AlertTriangle size={12} /> Please select at least {question.min_selections} option(s)
          </p>
        )}
        {question.max_selections && selectedIds.length > question.max_selections && (
          <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
            <AlertTriangle size={12} /> Maximum {question.max_selections} selections allowed
          </p>
        )}
      </div>
    );
  }

  if (qType === 'true_false') {
    return (
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt) => {
          const selected = answer.selectedOptionId === opt.id;
          const isTrue = opt.option_text.toLowerCase() === 'true';
          return (
            <button
              key={opt.id}
              onClick={() => onChange({ selectedOptionId: opt.id })}
              className={`flex flex-col items-center justify-center p-6 rounded-xl border-2 transition-all font-semibold text-lg ${
                selected
                  ? isTrue ? 'border-green-600 bg-green-50 text-green-700' : 'border-red-600 bg-red-50 text-red-700'
                  : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
              }`}
            >
              {opt.option_text}
            </button>
          );
        })}
      </div>
    );
  }

  if (qType === 'text_short') {
    return (
      <div>
        <input
          type="text"
          value={answer.textAnswer || ''}
          onChange={(e) => onChange({ textAnswer: e.target.value })}
          placeholder="Type your answer..."
          maxLength={question.char_limit || undefined}
          className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg text-sm text-slate-800 bg-white focus:outline-none focus:border-blue-500 transition-colors"
        />
        {question.char_limit && (
          <p className="text-xs text-slate-400 mt-1 text-right">{(answer.textAnswer || '').length} / {question.char_limit}</p>
        )}
      </div>
    );
  }

  if (qType === 'text_long') {
    return (
      <div>
        <textarea
          value={answer.textAnswer || ''}
          onChange={(e) => onChange({ textAnswer: e.target.value })}
          placeholder="Type your answer..."
          maxLength={question.char_limit || undefined}
          rows={5}
          className="w-full px-4 py-3 border-2 border-slate-200 rounded-lg text-sm text-slate-800 bg-white focus:outline-none focus:border-blue-500 transition-colors resize-y"
        />
        {question.char_limit && (
          <p className="text-xs text-slate-400 mt-1 text-right">{(answer.textAnswer || '').length} / {question.char_limit}</p>
        )}
      </div>
    );
  }

  return <p className="text-sm text-slate-500">Unsupported question type.</p>;
}
