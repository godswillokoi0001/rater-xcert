import type { Answer, AttemptWithDetails } from '@/types';

export interface ManualGradeItem {
  grade: 'correct' | 'incorrect' | 'partial';
  score: number;
  feedback: string;
}

export interface ManualGradingPayload {
  score: number;
  pass_or_fail: 'pass' | 'fail';
  correct_answers: number;
  total_questions: number;
  grades: Record<string, ManualGradeItem>;
  graded_at?: string;
  graded_by?: string;
}

export const MANUAL_GRADING_TAG_PREFIX = '[MANUAL_GRADING:';
export const MANUAL_GRADING_TAG_SUFFIX = ']';

/**
 * Encodes manual grading data into the admin_notes string so it is reliably
 * stored in the PostgreSQL database via release_attempt and readable by all roles.
 */
export function encodeManualGrading(
  cleanNotes: string,
  payload: ManualGradingPayload
): string {
  const jsonStr = JSON.stringify(payload);
  const trimmedNotes = (cleanNotes || '').trim();
  if (!trimmedNotes) {
    return `${MANUAL_GRADING_TAG_PREFIX}${jsonStr}${MANUAL_GRADING_TAG_SUFFIX}`;
  }
  return `${MANUAL_GRADING_TAG_PREFIX}${jsonStr}${MANUAL_GRADING_TAG_SUFFIX} ${trimmedNotes}`;
}

/**
 * Decodes manual grading data from admin_notes or localStorage fallback.
 */
export function decodeManualGrading(
  rawNotes?: string | null,
  attemptId?: string
): {
  score?: number;
  pass_or_fail?: 'pass' | 'fail';
  correct_answers?: number;
  total_questions?: number;
  grades?: Record<string, ManualGradeItem>;
  cleanNotes: string;
  isManual: boolean;
} {
  const notes = rawNotes || '';

  // 1. Try parsing from admin_notes tag
  if (notes.includes(MANUAL_GRADING_TAG_PREFIX)) {
    try {
      const startIndex = notes.indexOf(MANUAL_GRADING_TAG_PREFIX);
      const contentStart = startIndex + MANUAL_GRADING_TAG_PREFIX.length;
      const endIndex = notes.indexOf(MANUAL_GRADING_TAG_SUFFIX, contentStart);

      if (endIndex !== -1) {
        const jsonStr = notes.slice(contentStart, endIndex);
        const parsed = JSON.parse(jsonStr) as ManualGradingPayload;
        const cleanNotes = (notes.slice(0, startIndex) + notes.slice(endIndex + MANUAL_GRADING_TAG_SUFFIX.length)).trim();

        return {
          score: typeof parsed.score === 'number' ? parsed.score : undefined,
          pass_or_fail: parsed.pass_or_fail === 'pass' || parsed.pass_or_fail === 'fail' ? parsed.pass_or_fail : undefined,
          correct_answers: typeof parsed.correct_answers === 'number' ? parsed.correct_answers : undefined,
          total_questions: typeof parsed.total_questions === 'number' ? parsed.total_questions : undefined,
          grades: parsed.grades || {},
          cleanNotes,
          isManual: true,
        };
      }
    } catch (e) {
      console.warn('Failed to parse manual grading tag from admin_notes:', e);
    }
  }

  // 2. Fallback: check localStorage for recently saved manual grades
  if (attemptId && typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(`raterx_manual_grades_${attemptId}`);
      if (stored) {
        const parsed = JSON.parse(stored) as ManualGradingPayload;
        return {
          score: typeof parsed.score === 'number' ? parsed.score : undefined,
          pass_or_fail: parsed.pass_or_fail === 'pass' || parsed.pass_or_fail === 'fail' ? parsed.pass_or_fail : undefined,
          correct_answers: typeof parsed.correct_answers === 'number' ? parsed.correct_answers : undefined,
          total_questions: typeof parsed.total_questions === 'number' ? parsed.total_questions : undefined,
          grades: parsed.grades || {},
          cleanNotes: notes.trim(),
          isManual: true,
        };
      }
    } catch {
      // Ignore storage errors
    }
  }

  return {
    cleanNotes: notes.trim(),
    isManual: false,
  };
}

/**
 * Saves manual grading to localStorage as a client-side cache
 */
export function saveManualGradingToStorage(attemptId: string, payload: ManualGradingPayload) {
  if (typeof window !== 'undefined' && attemptId) {
    try {
      localStorage.setItem(`raterx_manual_grades_${attemptId}`, JSON.stringify(payload));
    } catch (e) {
      console.warn('Failed to cache manual grades in localStorage:', e);
    }
  }
}

/**
 * Enriches an attempt object with decoded manual grading values if present.
 */
export function applyManualGradingToAttempt<T extends {
  id?: string;
  admin_notes?: string | null;
  score?: number | string;
  pass_or_fail?: string;
  correct_answers?: number;
  total_questions?: number;
  answers?: Answer[] | any;
}>(attempt: T): T {
  if (!attempt) return attempt;

  const decoded = decodeManualGrading(attempt.admin_notes, attempt.id);
  if (!decoded.isManual) {
    return {
      ...attempt,
      admin_notes: decoded.cleanNotes,
    };
  }

  let updatedAnswers = attempt.answers;
  if (Array.isArray(attempt.answers) && decoded.grades) {
    updatedAnswers = attempt.answers.map((ans: Answer) => {
      const mg = decoded.grades?.[ans.question_id];
      if (mg) {
        return {
          ...ans,
          manual_grade: mg.grade,
          manual_score: mg.score,
          manual_feedback: mg.feedback,
        };
      }
      return ans;
    });
  }

  return {
    ...attempt,
    score: decoded.score !== undefined ? decoded.score : attempt.score,
    pass_or_fail: decoded.pass_or_fail || attempt.pass_or_fail,
    correct_answers: decoded.correct_answers !== undefined ? decoded.correct_answers : attempt.correct_answers,
    total_questions: decoded.total_questions !== undefined ? decoded.total_questions : attempt.total_questions,
    admin_notes: decoded.cleanNotes,
    answers: updatedAnswers,
  };
}

