-- ============================================================
-- Rater X Restructure: candidate approval, verification codes,
-- review settings, attempt progress tracking
-- ============================================================

-- 1. Candidate approval: new status values on profiles
--    Candidates start as 'pending_approval' after signup.
--    Admin sets to 'active' (approved) or 'rejected'.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check
    CHECK (status IN ('active', 'disabled', 'pending_approval', 'rejected'));

-- Update the trigger: new candidates start pending approval
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, status, permissions)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    'candidate',
    'pending_approval',
    '{}'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2. Verification codes table
CREATE TABLE IF NOT EXISTS public.verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  consumed boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verif_codes_user ON public.verification_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_verif_codes_code ON public.verification_codes(code);

ALTER TABLE public.verification_codes ENABLE ROW LEVEL SECURITY;
-- Users can only read/verify their own codes
DROP POLICY IF EXISTS "verif_select_own" ON public.verification_codes;
CREATE POLICY "verif_select_own"
  ON public.verification_codes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 3. Review settings: per-test score release mode
ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS review_mode text NOT NULL DEFAULT 'super_admin_approval'
    CHECK (review_mode IN ('immediate', 'super_admin_approval'));

-- 4. Attempt progress tracking (server-side, survives refresh)
ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS current_section_index integer NOT NULL DEFAULT 0;
ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS current_question_index integer NOT NULL DEFAULT 0;
ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS locked_questions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.attempts
  ADD COLUMN IF NOT EXISTS saved_answers jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 5. Helper: generate and store a verification code, return it (called via RPC from client)
CREATE OR REPLACE FUNCTION public.create_verification_code(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  -- Generate 6-digit code
  v_code := lpad((floor(random() * 1000000))::text, 6, '0');
  INSERT INTO public.verification_codes (user_id, code)
  VALUES (p_user_id, v_code);
  RETURN v_code;
END;
$$;

-- 6. Helper: verify a code
CREATE OR REPLACE FUNCTION public.verify_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record record;
BEGIN
  SELECT * INTO v_record
  FROM public.verification_codes
  WHERE user_id = auth.uid()
    AND code = p_code
    AND consumed = false
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.verification_codes
  SET consumed = true
  WHERE id = v_record.id;

  RETURN true;
END;
$$;

-- 7. Approve candidate (admin action)
CREATE OR REPLACE FUNCTION public.approve_candidate(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('can-manage-users') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-users required';
  END IF;
  UPDATE public.profiles SET status = 'active' WHERE id = p_user_id AND role = 'candidate';
  PERFORM public.log_audit('approve_candidate', 'user', p_user_id, jsonb_build_object('status', 'active'));
END;
$$;

-- 8. Reject candidate
CREATE OR REPLACE FUNCTION public.reject_candidate(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('can-manage-users') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-users required';
  END IF;
  UPDATE public.profiles SET status = 'rejected' WHERE id = p_user_id AND role = 'candidate';
  PERFORM public.log_audit('reject_candidate', 'user', p_user_id, jsonb_build_object('status', 'rejected'));
END;
$$;

-- 9. Start attempt (creates a placeholder attempt for progress tracking)
CREATE OR REPLACE FUNCTION public.start_attempt(p_test_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id uuid;
  v_test_status text;
  v_existing record;
  v_can_take jsonb;
BEGIN
  SELECT status INTO v_test_status FROM public.tests WHERE id = p_test_id;
  IF v_test_status IS NULL THEN
    RAISE EXCEPTION 'Test not found';
  END IF;
  IF v_test_status <> 'published' THEN
    RAISE EXCEPTION 'Test is not available';
  END IF;

  -- Check candidate is approved
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'candidate' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Your account must be approved by an administrator before taking tests.';
  END IF;

  -- Check can take
  SELECT * INTO v_existing
  FROM public.attempts
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id
    AND submitted_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    -- Resume existing in-progress attempt
    RETURN v_existing.id;
  END IF;

  -- Check no unreleased attempt or has retake unlock (reuse can_take_test logic)
  SELECT public.can_take_test(p_test_id) INTO v_can_take;
  IF NOT (v_can_take->>'can_take')::boolean THEN
    RAISE EXCEPTION '%', v_can_take->>'reason';
  END IF;

  INSERT INTO public.attempts (candidate_id, test_id, started_at, review_status)
  VALUES (auth.uid(), p_test_id, now(), 'pending_review')
  RETURNING id INTO v_attempt_id;

  RETURN v_attempt_id;
END;
$$;

-- 10. Save answer + advance question (locks previous question)
CREATE OR REPLACE FUNCTION public.save_answer_and_advance(
  p_attempt_id uuid,
  p_question_id uuid,
  p_selected_option_id uuid,
  p_next_question_index integer,
  p_next_section_index integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt record;
  v_locked jsonb;
  v_answers jsonb;
BEGIN
  SELECT * INTO v_attempt FROM public.attempts WHERE id = p_attempt_id AND candidate_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;
  IF v_attempt.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Test already submitted';
  END IF;

  -- Save the answer
  v_answers := v_attempt.saved_answers;
  v_answers := jsonb_set(v_answers, ARRAY[p_question_id::text],
    CASE WHEN p_selected_option_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(p_selected_option_id) END);

  -- Lock the current question (add to locked list)
  v_locked := v_attempt.locked_questions;
  IF NOT (v_locked @> to_jsonb(p_question_id::text)) THEN
    v_locked := v_locked || to_jsonb(p_question_id::text);
  END IF;

  UPDATE public.attempts
  SET saved_answers = v_answers,
      locked_questions = v_locked,
      current_question_index = p_next_question_index,
      current_section_index = p_next_section_index
  WHERE id = p_attempt_id;
END;
$$;

-- 11. Modified submit_attempt: respects review_mode (immediate vs super_admin)
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
  v_review_mode text;
  v_review_status text;
  v_existing_attempt record;
BEGIN
  SELECT status, review_mode INTO v_test_status, v_review_mode FROM public.tests WHERE id = p_test_id;
  IF v_test_status IS NULL THEN
    RAISE EXCEPTION 'Test not found';
  END IF;
  IF v_test_status <> 'published' THEN
    RAISE EXCEPTION 'Test is not available';
  END IF;

  -- Check candidate is approved
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'candidate' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Your account must be approved by an administrator.';
  END IF;

  -- Check if candidate already has an attempt for this test that hasn't been released
  SELECT * INTO v_existing_attempt
  FROM public.attempts
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id
    AND review_status IN ('pending_review', 'reviewed')
    AND submitted_at IS NOT NULL
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'You have already taken this test. Your results are awaiting admin review.';
  END IF;

  -- Check retake unlock for released attempts
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
      RAISE EXCEPTION 'You have already taken this test. An admin must grant you a retake.';
    END IF;
  END IF;

  -- Determine review status based on test setting
  v_review_status := CASE WHEN v_review_mode = 'immediate' THEN 'released' ELSE 'pending_review' END;

  -- Count total questions
  SELECT COUNT(*) INTO v_total_questions
  FROM public.questions q
  JOIN public.sections s ON s.id = q.section_id
  WHERE s.test_id = p_test_id;

  -- Score each answer
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

  IF v_total_questions > 0 THEN
    v_score := ROUND((v_correct_answers::numeric / v_total_questions::numeric) * 100, 2);
  ELSE
    v_score := 0;
  END IF;

  SELECT pass_mark INTO v_pass_mark FROM public.tests WHERE id = p_test_id;
  v_pass_fail := CASE WHEN v_score >= v_pass_mark THEN 'pass' ELSE 'fail' END;

  -- Find existing in-progress attempt to update, or create new
  SELECT id INTO v_attempt_id
  FROM public.attempts
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id
    AND submitted_at IS NULL
  LIMIT 1;

  IF v_attempt_id IS NOT NULL THEN
    UPDATE public.attempts
    SET submitted_at = now(),
        per_section_time_used = p_per_section_time_used,
        score = v_score,
        pass_or_fail = v_pass_fail,
        answers = p_answers,
        total_questions = v_total_questions,
        correct_answers = v_correct_answers,
        review_status = v_review_status,
        released_at = CASE WHEN v_review_mode = 'immediate' THEN now() ELSE NULL END,
        released_by = CASE WHEN v_review_mode = 'immediate' THEN auth.uid() ELSE NULL END
    WHERE id = v_attempt_id;
  ELSE
    INSERT INTO public.attempts (
      candidate_id, test_id, submitted_at, per_section_time_used,
      score, pass_or_fail, answers, total_questions, correct_answers,
      review_status, released_at, released_by
    )
    VALUES (
      auth.uid(), p_test_id, now(), p_per_section_time_used,
      v_score, v_pass_fail, p_answers, v_total_questions, v_correct_answers,
      v_review_status,
      CASE WHEN v_review_mode = 'immediate' THEN now() ELSE NULL END,
      CASE WHEN v_review_mode = 'immediate' THEN auth.uid() ELSE NULL END
    )
    RETURNING id INTO v_attempt_id;
  END IF;

  -- Consume retake unlock if existed
  DELETE FROM public.test_unlocks WHERE candidate_id = auth.uid() AND test_id = p_test_id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'review_status', v_review_status,
    'review_mode', v_review_mode
  );
END;
$$;

-- 12. Get attempt progress (for resume after refresh)
CREATE OR REPLACE FUNCTION public.get_attempt_progress(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt record;
BEGIN
  SELECT * INTO v_attempt FROM public.attempts WHERE id = p_attempt_id AND candidate_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;

  RETURN jsonb_build_object(
    'current_section_index', v_attempt.current_section_index,
    'current_question_index', v_attempt.current_question_index,
    'locked_questions', v_attempt.locked_questions,
    'saved_answers', v_attempt.saved_answers,
    'submitted_at', v_attempt.submitted_at
  );
END;
$$;
