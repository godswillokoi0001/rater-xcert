-- ============================================================
-- ATTEMPT REVIEW & RELEASE SYSTEM
-- ============================================================
-- Adds a review workflow: after a candidate submits a test,
-- the score is hidden until a super_admin reviews and releases it.
-- Candidates cannot retake a test until the admin releases it
-- (and optionally grants a retake).

-- Add review columns to attempts
ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN ('pending_review', 'reviewed', 'released'));

ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS released_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS admin_notes text NOT NULL DEFAULT '';

-- Track which tests a candidate is allowed to retake
-- (admin grants retake after releasing a score)
CREATE TABLE IF NOT EXISTS public.test_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  unlocked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (candidate_id, test_id)
);

CREATE INDEX IF NOT EXISTS idx_test_unlocks_candidate ON public.test_unlocks(candidate_id);
CREATE INDEX IF NOT EXISTS idx_test_unlocks_test ON public.test_unlocks(test_id);

-- RLS on test_unlocks: candidates can read their own unlocks, admins can read all
ALTER TABLE public.test_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "test_unlocks_select_own_or_admin" ON public.test_unlocks;
CREATE POLICY "test_unlocks_select_own_or_admin"
  ON public.test_unlocks FOR SELECT
  TO authenticated
  USING (auth.uid() = candidate_id OR public.is_admin());

-- All writes go through SECURITY DEFINER functions

-- ============================================================
-- MODIFIED submit_attempt: sets review_status to 'pending_review'
-- and blocks submission if candidate has an unreleased attempt
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_attempt(
  p_test_id uuid,
  p_answers jsonb,
  p_per_section_time_used jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id uuid;
  v_total_questions integer := 0;
  v_correct_answers integer := 0;
  v_score numeric;
  v_pass_mark integer;
  v_pass_fail text;
  v_answer jsonb;
  v_question_id uuid;
  v_selected_option_id uuid;
  v_is_correct boolean;
  v_test_status text;
  v_existing_attempt record;
BEGIN
  -- Verify test is published
  SELECT status INTO v_test_status FROM public.tests WHERE id = p_test_id;
  IF v_test_status IS NULL THEN
    RAISE EXCEPTION 'Test not found';
  END IF;
  IF v_test_status <> 'published' THEN
    RAISE EXCEPTION 'Test is not available';
  END IF;

  -- Check if candidate already has an attempt for this test that hasn't been released
  SELECT * INTO v_existing_attempt
  FROM public.attempts
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id
    AND review_status IN ('pending_review', 'reviewed')
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'You have already taken this test. Your results are awaiting admin review.';
  END IF;

  -- Check if candidate has a released attempt but no retake unlock
  PERFORM 1
  FROM public.attempts a
  WHERE a.candidate_id = auth.uid()
    AND a.test_id = p_test_id
    AND a.review_status = 'released'
  LIMIT 1;

  IF FOUND THEN
    PERFORM 1 FROM public.test_unlocks
    WHERE candidate_id = auth.uid() AND test_id = p_test_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'You have already taken this test. An admin must grant you a retake before you can take it again.';
    END IF;
  END IF;

  -- Count total questions across all sections
  SELECT COUNT(*) INTO v_total_questions
  FROM public.questions q
  JOIN public.sections s ON s.id = q.section_id
  WHERE s.test_id = p_test_id;

  -- Score each answer server-side
  FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
    v_question_id := (v_answer->>'question_id')::uuid;
    v_selected_option_id := CASE WHEN v_answer->>'selected_option_id' IS NULL THEN NULL ELSE (v_answer->>'selected_option_id')::uuid END;

    IF v_selected_option_id IS NOT NULL THEN
      SELECT is_correct INTO v_is_correct FROM public.options WHERE id = v_selected_option_id AND question_id = v_question_id;
      IF v_is_correct THEN
        v_correct_answers := v_correct_answers + 1;
      END IF;
    END IF;
  END LOOP;

  -- Calculate score as percentage
  IF v_total_questions > 0 THEN
    v_score := ROUND((v_correct_answers::numeric / v_total_questions::numeric) * 100, 2);
  ELSE
    v_score := 0;
  END IF;

  SELECT pass_mark INTO v_pass_mark FROM public.tests WHERE id = p_test_id;
  v_pass_fail := CASE WHEN v_score >= v_pass_mark THEN 'pass' ELSE 'fail' END;

  INSERT INTO public.attempts (
    candidate_id, test_id, submitted_at, per_section_time_used,
    score, pass_or_fail, answers, total_questions, correct_answers,
    review_status
  )
  VALUES (
    auth.uid(), p_test_id, now(), p_per_section_time_used,
    v_score, v_pass_fail, p_answers, v_total_questions, v_correct_answers,
    'pending_review'
  )
  RETURNING id INTO v_attempt_id;

  -- Consume the retake unlock if one existed (candidate used it)
  DELETE FROM public.test_unlocks WHERE candidate_id = auth.uid() AND test_id = p_test_id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'review_status', 'pending_review'
  );
END;
$$;

-- ============================================================
-- ADMIN: Review attempt (get full details including answers)
-- Super admin only
-- ============================================================
CREATE OR REPLACE FUNCTION public.review_attempt(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt record;
  v_result jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin required to review attempts';
  END IF;

  SELECT * INTO v_attempt FROM public.attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;

  -- Mark as reviewed
  IF v_attempt.review_status = 'pending_review' THEN
    UPDATE public.attempts SET review_status = 'reviewed' WHERE id = p_attempt_id;
  END IF;

  SELECT jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'answers', v_attempt.answers
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================
-- ADMIN: Release attempt score to candidate
-- Super admin only — also optionally grants retake
-- ============================================================
CREATE OR REPLACE FUNCTION public.release_attempt(
  p_attempt_id uuid,
  p_admin_notes text DEFAULT '',
  p_grant_retake boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt record;
  v_candidate_email text;
  v_candidate_name text;
  v_test_title text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin required to release attempts';
  END IF;

  SELECT * INTO v_attempt FROM public.attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;

  IF v_attempt.review_status = 'released' THEN
    RAISE EXCEPTION 'Attempt already released';
  END IF;

  -- Get candidate email and test title for notification
  SELECT email INTO v_candidate_email FROM auth.users WHERE id = v_attempt.candidate_id;
  SELECT name INTO v_candidate_name FROM public.profiles WHERE id = v_attempt.candidate_id;
  SELECT title INTO v_test_title FROM public.tests WHERE id = v_attempt.test_id;

  -- Release the score
  UPDATE public.attempts
  SET review_status = 'released',
      released_at = now(),
      released_by = auth.uid(),
      admin_notes = p_admin_notes
  WHERE id = p_attempt_id;

  -- Optionally grant retake
  IF p_grant_retake THEN
    INSERT INTO public.test_unlocks (candidate_id, test_id, unlocked_by)
    VALUES (v_attempt.candidate_id, v_attempt.test_id, auth.uid())
    ON CONFLICT (candidate_id, test_id) DO NOTHING;
  END IF;

  -- Log the action
  PERFORM public.log_audit('release_attempt', 'attempt', p_attempt_id,
    jsonb_build_object(
      'candidate_email', v_candidate_email,
      'test_title', v_test_title,
      'score', v_attempt.score,
      'grant_retake', p_grant_retake,
      'admin_notes', p_admin_notes
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'candidate_email', v_candidate_email,
    'candidate_name', v_candidate_name,
    'test_title', v_test_title,
    'score', v_attempt.score,
    'pass_or_fail', v_attempt.pass_or_fail,
    'correct_answers', v_attempt.correct_answers,
    'total_questions', v_attempt.total_questions
  );
END;
$$;

-- ============================================================
-- ADMIN: Grant retake (separate from release)
-- Super admin only
-- ============================================================
CREATE OR REPLACE FUNCTION public.grant_retake(
  p_candidate_id uuid,
  p_test_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate_name text;
  v_test_title text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin required to grant retakes';
  END IF;

  SELECT name INTO v_candidate_name FROM public.profiles WHERE id = p_candidate_id;
  SELECT title INTO v_test_title FROM public.tests WHERE id = p_test_id;

  INSERT INTO public.test_unlocks (candidate_id, test_id, unlocked_by)
  VALUES (p_candidate_id, p_test_id, auth.uid())
  ON CONFLICT (candidate_id, test_id) DO NOTHING;

  PERFORM public.log_audit('grant_retake', 'test', p_test_id,
    jsonb_build_object('candidate_id', p_candidate_id, 'candidate_name', v_candidate_name, 'test_title', v_test_title)
  );
END;
$$;

-- ============================================================
-- CANDIDATE: Get released attempts only (for dashboard display)
-- This function ensures candidates can only see scores that have been released
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_released_attempts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'test_id', a.test_id,
      'submitted_at', a.submitted_at,
      'score', a.score,
      'pass_or_fail', a.pass_or_fail,
      'total_questions', a.total_questions,
      'correct_answers', a.correct_answers,
      'review_status', a.review_status,
      'test_title', t.title
    )
  ), '[]'::jsonb) INTO v_result
  FROM public.attempts a
  JOIN public.tests t ON t.id = a.test_id
  WHERE a.candidate_id = auth.uid();

  RETURN v_result;
END;
$$;

-- ============================================================
-- CANDIDATE: Check if can take a test (no unreleased attempt, or has retake unlock)
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_take_test(p_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_unreleased boolean;
  v_has_released boolean;
  v_has_unlock boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.attempts
    WHERE candidate_id = auth.uid()
      AND test_id = p_test_id
      AND review_status IN ('pending_review', 'reviewed')
  ) INTO v_has_unreleased;

  SELECT EXISTS(
    SELECT 1 FROM public.attempts
    WHERE candidate_id = auth.uid()
      AND test_id = p_test_id
      AND review_status = 'released'
  ) INTO v_has_released;

  SELECT EXISTS(
    SELECT 1 FROM public.test_unlocks
    WHERE candidate_id = auth.uid()
      AND test_id = p_test_id
  ) INTO v_has_unlock;

  RETURN jsonb_build_object(
    'can_take', (NOT v_has_unreleased AND (NOT v_has_released OR v_has_unlock)),
    'reason', CASE
      WHEN v_has_unreleased THEN 'Your previous attempt is awaiting admin review.'
      WHEN v_has_released AND NOT v_has_unlock THEN 'You have already taken this test. An admin must grant you a retake.'
      ELSE NULL
    END
  );
END;
$$;
