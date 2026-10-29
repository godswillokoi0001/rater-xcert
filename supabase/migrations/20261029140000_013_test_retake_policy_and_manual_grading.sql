/*
# Retake Policy on Tests & Manual Grading for Text Questions

## Overview
1. Adds `retakes_allowed` and `retake_on_fail_only` to `public.tests` table.
   - `retakes_allowed`: -1 for unlimited, 0 for no retakes, N for specific number of retakes.
   - `retake_on_fail_only`: boolean, defaults to true.
2. Updates `create_test` and `update_test` RPCs to support retake configuration.
3. Updates `can_take_test` to automatically allow retakes when candidates fail according to test policy.
4. Adds `grade_attempt_answers` RPC to allow admins to record manual scores for short/long answer questions.
*/

-- 1. Add retake configuration columns to tests
ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS retakes_allowed integer NOT NULL DEFAULT 0;

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS retake_on_fail_only boolean NOT NULL DEFAULT true;

-- 2. Update create_test to accept retake settings
CREATE OR REPLACE FUNCTION public.create_test(
  p_title text,
  p_description text DEFAULT '',
  p_pass_mark integer DEFAULT 70,
  p_review_mode text DEFAULT 'super_admin_approval',
  p_retakes_allowed integer DEFAULT 0,
  p_retake_on_fail_only boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_test_id uuid;
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;

  INSERT INTO public.tests (
    title, description, pass_mark, review_mode, status, created_by,
    retakes_allowed, retake_on_fail_only
  )
  VALUES (
    p_title, p_description, p_pass_mark,
    CASE WHEN p_review_mode = 'immediate' THEN 'immediate' ELSE 'super_admin_approval' END,
    'draft', auth.uid(),
    p_retakes_allowed, p_retake_on_fail_only
  )
  RETURNING id INTO v_test_id;

  PERFORM public.log_audit('create_test', 'test', v_test_id,
    jsonb_build_object(
      'title', p_title,
      'pass_mark', p_pass_mark,
      'review_mode', p_review_mode,
      'retakes_allowed', p_retakes_allowed,
      'retake_on_fail_only', p_retake_on_fail_only
    )
  );

  RETURN v_test_id;
END;
$$;

-- 3. Update update_test to accept retake settings
CREATE OR REPLACE FUNCTION public.update_test(
  p_test_id uuid,
  p_title text,
  p_description text DEFAULT '',
  p_pass_mark integer DEFAULT 70,
  p_status text DEFAULT 'draft',
  p_review_mode text DEFAULT 'super_admin_approval',
  p_retakes_allowed integer DEFAULT 0,
  p_retake_on_fail_only boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;

  UPDATE public.tests
  SET title = p_title,
      description = p_description,
      pass_mark = p_pass_mark,
      status = p_status,
      review_mode = CASE WHEN p_review_mode = 'immediate' THEN 'immediate' ELSE 'super_admin_approval' END,
      retakes_allowed = p_retakes_allowed,
      retake_on_fail_only = p_retake_on_fail_only
  WHERE id = p_test_id;

  PERFORM public.log_audit('update_test', 'test', p_test_id,
    jsonb_build_object(
      'title', p_title,
      'status', p_status,
      'pass_mark', p_pass_mark,
      'review_mode', p_review_mode,
      'retakes_allowed', p_retakes_allowed,
      'retake_on_fail_only', p_retake_on_fail_only
    )
  );
END;
$$;

-- 4. Update can_take_test: checks test-level retake policy and individual unlocks
CREATE OR REPLACE FUNCTION public.can_take_test(p_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_test record;
  v_has_unreleased boolean;
  v_latest_attempt record;
  v_completed_count integer := 0;
  v_unlock record;
  v_can_retake boolean := false;
  v_retakes_left integer := 0;
  v_reason text := NULL;
BEGIN
  -- Fetch test settings
  SELECT * INTO v_test FROM public.tests WHERE id = p_test_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_take', false, 'reason', 'Test not found', 'retakes_remaining', 0);
  END IF;

  -- Check if candidate has an unreleased attempt
  SELECT EXISTS(
    SELECT 1 FROM public.attempts
    WHERE candidate_id = auth.uid()
      AND test_id = p_test_id
      AND review_status IN ('pending_review', 'reviewed')
      AND submitted_at IS NOT NULL
  ) INTO v_has_unreleased;

  IF v_has_unreleased THEN
    RETURN jsonb_build_object(
      'can_take', false,
      'reason', 'Your previous attempt is awaiting admin review.',
      'retakes_remaining', 0
    );
  END IF;

  -- Count released/completed attempts
  SELECT COUNT(*) INTO v_completed_count
  FROM public.attempts
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id
    AND review_status = 'released';

  -- If candidate has never taken this test, they can take it
  IF v_completed_count = 0 THEN
    RETURN jsonb_build_object(
      'can_take', true,
      'reason', NULL,
      'retakes_remaining', CASE WHEN v_test.retakes_allowed = -1 THEN 999 ELSE v_test.retakes_allowed END
    );
  END IF;

  -- Get latest released attempt to inspect pass/fail
  SELECT * INTO v_latest_attempt
  FROM public.attempts
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id
    AND review_status = 'released'
  ORDER BY submitted_at DESC
  LIMIT 1;

  -- Check manual override from test_unlocks
  SELECT * INTO v_unlock
  FROM public.test_unlocks
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id;

  -- Test-level retake check
  IF v_test.retakes_allowed = -1 THEN
    -- Unlimited retakes
    IF NOT v_test.retake_on_fail_only OR v_latest_attempt.pass_or_fail = 'fail' THEN
      v_can_retake := true;
      v_retakes_left := 999;
    END IF;
  ELSIF v_test.retakes_allowed > 0 THEN
    -- Candidate has taken test (v_completed_count) times; retakes used is (v_completed_count - 1)
    IF (v_completed_count - 1) < v_test.retakes_allowed THEN
      IF NOT v_test.retake_on_fail_only OR v_latest_attempt.pass_or_fail = 'fail' THEN
        v_can_retake := true;
        v_retakes_left := v_test.retakes_allowed - (v_completed_count - 1);
      END IF;
    END IF;
  END IF;

  -- Manual admin unlock override
  IF v_unlock IS NOT NULL AND v_unlock.retakes_used < v_unlock.retakes_allowed THEN
    v_can_retake := true;
    v_retakes_left := GREATEST(v_retakes_left, v_unlock.retakes_allowed - v_unlock.retakes_used);
  END IF;

  IF NOT v_can_retake THEN
    IF v_latest_attempt.pass_or_fail = 'pass' AND v_test.retake_on_fail_only THEN
      v_reason := 'You have already passed this test.';
    ELSIF v_test.retakes_allowed = 0 AND v_unlock IS NULL THEN
      v_reason := 'You have already taken this test. Retakes are not enabled for this test.';
    ELSE
      v_reason := 'You have reached the maximum number of retakes for this test.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'can_take', v_can_retake,
    'reason', v_reason,
    'retakes_remaining', v_retakes_left
  );
END;
$$;

-- 5. RPC to grade manual answers (short & long text answers)
CREATE OR REPLACE FUNCTION public.grade_attempt_answers(
  p_attempt_id uuid,
  p_answers jsonb,
  p_score numeric,
  p_pass_or_fail text,
  p_correct_answers integer,
  p_total_questions integer,
  p_admin_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin access required to grade attempts';
  END IF;

  SELECT * INTO v_attempt FROM public.attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;

  UPDATE public.attempts
  SET answers = p_answers,
      score = p_score,
      pass_or_fail = p_pass_or_fail,
      correct_answers = p_correct_answers,
      total_questions = p_total_questions,
      admin_notes = p_admin_notes
  WHERE id = p_attempt_id;

  PERFORM public.log_audit('grade_attempt_answers', 'attempt', p_attempt_id,
    jsonb_build_object(
      'score', p_score,
      'pass_or_fail', p_pass_or_fail,
      'correct_answers', p_correct_answers,
      'total_questions', p_total_questions
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'attempt_id', p_attempt_id,
    'score', p_score,
    'pass_or_fail', p_pass_or_fail
  );
END;
$$;

