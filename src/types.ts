export type Role = 'candidate' | 'worker' | 'admin' | 'super_admin';
export type UserStatus = 'active' | 'disabled' | 'pending';
export type TestStatus = 'draft' | 'published' | 'archived';
export type PassFail = 'pass' | 'fail';
export type ReviewMode = 'immediate' | 'super_admin_approval';
export type QuestionType = 'single_choice' | 'multi_select' | 'text_short' | 'text_long' | 'dropdown' | 'true_false';
export type ScoringMode = 'all_or_nothing' | 'partial_credit';
export type TestTargetRole = 'all' | 'candidate' | 'worker';

export const PERMISSIONS = [
  'can-upload-questions',
  'can-manage-users',
  'can-manage-tests',
  'can-view-reports',
] as const;

export type Permission = typeof PERMISSIONS[number];

export interface Profile {
  id: string;
  name: string;
  email?: string;
  role: Role;
  status: UserStatus;
  permissions: string[];
  created_at: string;
  last_login: string | null;
  email_verified: boolean;
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface Test {
  id: string;
  title: string;
  description: string;
  created_by: string | null;
  status: TestStatus;
  pass_mark: number;
  review_mode: ReviewMode;
  created_at: string;
  retakes_allowed?: number;
  retake_on_fail_only?: boolean;
  target_role?: TestTargetRole;
}

export interface UserTestAccess {
  id: string;
  user_id: string;
  test_id: string;
  access_type: 'blocked' | 'granted';
  notes?: string;
  created_at: string;
  created_by?: string;
}

export interface Section {
  id: string;
  test_id: string;
  title: string;
  timer_minutes: number;
  order_index: number;
  instructions: string;
}

export interface Question {
  id: string;
  section_id: string;
  question_image: string;
  instructions: string;
  external_link: string;
  order_index: number;
  question_type: QuestionType;
  question_text: string;
  min_selections: number | null;
  max_selections: number | null;
  char_limit: number | null;
  scoring_mode: ScoringMode;
}

export interface Option {
  id: string;
  question_id: string;
  option_label: string;
  option_text: string;
  is_correct: boolean;
}

export interface QuestionLink {
  id: string;
  question_id: string;
  url: string;
  label: string;
  order_index: number;
}

export interface Answer {
  question_id: string;
  selected_option_id: string | null;
  selected_option_ids?: string[];
  text_answer?: string;
  manual_grade?: 'correct' | 'incorrect' | 'partial';
  manual_score?: number; // e.g. 1 for full, 0 for incorrect, 0.5 for partial
  manual_feedback?: string;
}

export type ReviewStatus = 'pending_review' | 'reviewed' | 'released';

export interface Attempt {
  id: string;
  candidate_id: string;
  test_id: string;
  started_at: string;
  submitted_at: string | null;
  per_section_time_used: Record<string, number>;
  score: number;
  pass_or_fail: PassFail;
  answers: Answer[];
  total_questions: number;
  correct_answers: number;
  review_status: ReviewStatus;
  released_at: string | null;
  released_by: string | null;
  admin_notes: string;
}

export interface AttemptWithDetails extends Attempt {
  test_title?: string;
  candidate_name?: string;
  candidate_email?: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  admin_id: string;
  admin_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface TestWithCounts extends Test {
  section_count?: number;
  question_count?: number;
}

export interface ReviewData {
  attempt: Attempt;
  test_title: string;
  pass_mark: number;
  candidate_name: string;
  candidate_email: string;
  candidate_role?: string;
  sections: any[];
  questions: any[];
  options: any[];
  links: any[];
}
