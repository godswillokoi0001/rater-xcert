/*
# Question Types, Retake Limits, and Scoring Modes

## Overview
Adds support for multiple question types beyond image-only single-choice,
introduces retake limits (admin-configurable count per candidate),
and adds per-question scoring mode for multi-select questions.

## Changes

### 1. questions table -- new columns
- `question_type` (text): Type of question. Values: single_choice, multi_select,
  text_short, text_long, dropdown, true_false. Defaults to single_choice.
- `question_text` (text): The question prompt text. Questions no longer require an image.
- `min_selections` (integer): Minimum selections for multi_select. Nullable.
- `max_selections` (integer): Maximum selections for multi_select. Nullable.
- `char_limit` (integer): Character limit for text_short/text_long. Nullable.
- `scoring_mode` (text): For multi_select: 'all_or_nothing' or 'partial_credit'. Defaults to all_or_nothing.

### 2. test_unlocks table -- retake tracking columns
- `retakes_allowed` (integer): How many retakes the admin granted. Default 1.
- `retakes_used` (integer): How many retakes the candidate has consumed. Default 0.

### 3. Updated RPC functions
- `can_take_test`: Now checks retakes_used < retakes_allowed instead of just row existence.
- `start_attempt`: Updated to use new can_take_test logic.
- `submit_attempt`: Updated to handle multi-select scoring with partial_credit
  and all_or_nothing modes, skip scoring for text questions, increment retakes_used
  instead of deleting the unlock row.
- `create_question`: Accepts new columns.
- `update_question`: Accepts new columns.

## Security
- No new tables; existing RLS policies remain in effect.
- All writes still go through SECURITY DEFINER functions.
*/

-- 1. Add new columns to questions
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question_type text NOT NULL DEFAULT 'single_choice'
    CHECK (question_type IN ('single_choice', 'multi_select', 'text_short', 'text_long', 'dropdown', 'true_false'));

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question_text text NOT NULL DEFAULT '';

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS min_selections integer;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS max_selections integer;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS char_limit integer;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS scoring_mode text NOT NULL DEFAULT 'all_or_nothing'
    CHECK (scoring_mode IN ('all_or_nothing', 'partial_credit'));

-- 2. Add retake tracking columns to test_unlocks
ALTER TABLE public.test_unlocks
  ADD COLUMN IF NOT EXISTS retakes_allowed integer NOT NULL DEFAULT 1;

ALTER TABLE public.test_unlocks
  ADD COLUMN IF NOT EXISTS retakes_used integer NOT NULL DEFAULT 0;

-- 3. Updated can_take_test: checks retakes_used < retakes_allowed
CREATE OR REPLACE FUNCTION public.can_take_test(p_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_unreleased boolean;
  v_has_released boolean;
  v_unlock record;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.attempts
    WHERE candidate_id = auth.uid()
      AND test_id = p_test_id
      AND review_status IN ('pending_review', 'reviewed')
      AND submitted_at IS NOT NULL
  ) INTO v_has_unreleased;

  SELECT EXISTS(
    SELECT 1 FROM public.attempts
    WHERE candidate_id = auth.uid()
      AND test_id = p_test_id
      AND review_status = 'released'
  ) INTO v_has_released;

  SELECT * INTO v_unlock
  FROM public.test_unlocks
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id;

  RETURN jsonb_build_object(
    'can_take', (
      NOT v_has_unreleased
      AND (
        NOT v_has_released
        OR (v_unlock IS NOT NULL AND v_unlock.retakes_used < v_unlock.retakes_allowed)
      )
    ),
    'reason', CASE
      WHEN v_has_unreleased THEN 'Your previous attempt is awaiting admin review.'
      WHEN v_has_released AND v_unlock IS NULL THEN 'You have already taken this test. An admin must grant you a retake.'
      WHEN v_has_released AND v_unlock IS NOT NULL AND v_unlock.retakes_used >= v_unlock.retakes_allowed THEN 'You have used all your granted retakes for this test.'
      ELSE NULL
    END,
    'retakes_remaining', CASE
      WHEN v_unlock IS NOT NULL THEN v_unlock.retakes_allowed - v_unlock.retakes_used
      ELSE 0
    END
  );
END;
$$;

-- 4. Updated start_attempt
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

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'candidate' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Your account must be approved by an administrator before taking tests.';
  END IF;

  SELECT * INTO v_existing
  FROM public.attempts
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id
    AND submitted_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing.id;
  END IF;

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

-- 5. Updated submit_attempt: multi-select scoring + retake increment
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
  v_scorable_questions integer := 0;
  v_correct_answers integer := 0;
  v_partial_score numeric := 0;
  v_score numeric;
  v_pass_mark integer;
  v_pass_fail text;
  v_answer jsonb;
  v_question_id uuid;
  v_selected_option_id uuid;
  v_selected_option_ids jsonb;
  v_is_correct boolean;
  v_test_status text;
  v_review_mode text;
  v_review_status text;
  v_existing_attempt record;
  v_q_type text;
  v_q_scoring_mode text;
  v_correct_count integer;
  v_total_correct integer;
  v_selected_count integer;
  v_wrong_count integer;
BEGIN
  SELECT status, review_mode INTO v_test_status, v_review_mode FROM public.tests WHERE id = p_test_id;
  IF v_test_status IS NULL THEN
    RAISE EXCEPTION 'Test not found';
  END IF;
  IF v_test_status <> 'published' THEN
    RAISE EXCEPTION 'Test is not available';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'candidate' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Your account must be approved by an administrator.';
  END IF;

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

  PERFORM 1
  FROM public.attempts a
  WHERE a.candidate_id = auth.uid()
    AND a.test_id = p_test_id
    AND a.review_status = 'released'
  LIMIT 1;

  IF FOUND THEN
    PERFORM 1 FROM public.test_unlocks
    WHERE candidate_id = auth.uid()
      AND test_id = p_test_id
      AND retakes_used < retakes_allowed;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'You have already taken this test. An admin must grant you a retake.';
    END IF;
  END IF;

  v_review_status := CASE WHEN v_review_mode = 'immediate' THEN 'released' ELSE 'pending_review' END;

  SELECT COUNT(*) INTO v_total_questions
  FROM public.questions q
  JOIN public.sections s ON s.id = q.section_id
  WHERE s.test_id = p_test_id;

  -- Count only auto-scorable questions (not text-based)
  SELECT COUNT(*) INTO v_scorable_questions
  FROM public.questions q
  JOIN public.sections s ON s.id = q.section_id
  WHERE s.test_id = p_test_id
    AND q.question_type NOT IN ('text_short', 'text_long');

  FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
    v_question_id := (v_answer->>'question_id')::uuid;

    SELECT question_type, scoring_mode INTO v_q_type, v_q_scoring_mode
    FROM public.questions WHERE id = v_question_id;

    IF v_q_type IN ('text_short', 'text_long') THEN
      CONTINUE;
    END IF;

    IF v_q_type = 'multi_select' THEN
      v_selected_option_ids := v_answer->'selected_option_ids';
      IF v_selected_option_ids IS NOT NULL AND jsonb_array_length(v_selected_option_ids) > 0 THEN
        SELECT COUNT(*) INTO v_total_correct
        FROM public.options WHERE question_id = v_question_id AND is_correct = true;

        SELECT COUNT(*) INTO v_correct_count
        FROM public.options
        WHERE question_id = v_question_id
          AND is_correct = true
          AND id::text IN (SELECT jsonb_array_elements_text(v_selected_option_ids));

        v_selected_count := jsonb_array_length(v_selected_option_ids);
        v_wrong_count := v_selected_count - v_correct_count;

        IF v_q_scoring_mode = 'all_or_nothing' THEN
          IF v_correct_count = v_total_correct AND v_wrong_count = 0 THEN
            v_correct_answers := v_correct_answers + 1;
          END IF;
        ELSE
          -- partial_credit: (correct_selected - wrong_selected) / total_correct, min 0
          IF v_total_correct > 0 THEN
            v_partial_score := v_partial_score + GREATEST(0, (v_correct_count::numeric - v_wrong_count::numeric) / v_total_correct::numeric);
          END IF;
        END IF;
      END IF;
    ELSE
      -- single_choice, dropdown, true_false
      v_selected_option_id := CASE
        WHEN v_answer->>'selected_option_id' IS NULL THEN NULL
        ELSE (v_answer->>'selected_option_id')::uuid
      END;

      IF v_selected_option_id IS NOT NULL THEN
        SELECT is_correct INTO v_is_correct
        FROM public.options WHERE id = v_selected_option_id AND question_id = v_question_id;
        IF v_is_correct THEN
          v_correct_answers := v_correct_answers + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF v_scorable_questions > 0 THEN
    v_score := ROUND(((v_correct_answers::numeric + v_partial_score) / v_scorable_questions::numeric) * 100, 2);
  ELSE
    v_score := 0;
  END IF;

  SELECT pass_mark INTO v_pass_mark FROM public.tests WHERE id = p_test_id;
  v_pass_fail := CASE WHEN v_score >= v_pass_mark THEN 'pass' ELSE 'fail' END;

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
        total_questions = v_scorable_questions,
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
      v_score, v_pass_fail, p_answers, v_scorable_questions, v_correct_answers,
      v_review_status,
      CASE WHEN v_review_mode = 'immediate' THEN now() ELSE NULL END,
      CASE WHEN v_review_mode = 'immediate' THEN auth.uid() ELSE NULL END
    )
    RETURNING id INTO v_attempt_id;
  END IF;

  -- Increment retakes_used instead of deleting the unlock
  UPDATE public.test_unlocks
  SET retakes_used = retakes_used + 1
  WHERE candidate_id = auth.uid() AND test_id = p_test_id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'review_status', v_review_status,
    'review_mode', v_review_mode
  );
END;
$$;

-- 6. Updated create_question: accepts new columns
CREATE OR REPLACE FUNCTION public.create_question(
  p_section_id uuid,
  p_question_image text DEFAULT '',
  p_instructions text DEFAULT '',
  p_external_link text DEFAULT '',
  p_question_type text DEFAULT 'single_choice',
  p_question_text text DEFAULT '',
  p_min_selections integer DEFAULT NULL,
  p_max_selections integer DEFAULT NULL,
  p_char_limit integer DEFAULT NULL,
  p_scoring_mode text DEFAULT 'all_or_nothing'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_question_id uuid;
  v_next_order integer;
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;

  SELECT COALESCE(MAX(order_index), -1) + 1 INTO v_next_order
  FROM public.questions WHERE section_id = p_section_id;

  INSERT INTO public.questions (
    section_id, question_image, instructions, external_link, order_index,
    question_type, question_text, min_selections, max_selections, char_limit, scoring_mode
  )
  VALUES (
    p_section_id, p_question_image, p_instructions, p_external_link, v_next_order,
    p_question_type, p_question_text, p_min_selections, p_max_selections, p_char_limit,
    CASE WHEN p_scoring_mode = 'partial_credit' THEN 'partial_credit' ELSE 'all_or_nothing' END
  )
  RETURNING id INTO v_question_id;

  RETURN v_question_id;
END;
$$;

-- 7. Updated update_question: accepts new columns
CREATE OR REPLACE FUNCTION public.update_question(
  p_question_id uuid,
  p_question_image text DEFAULT '',
  p_instructions text DEFAULT '',
  p_external_link text DEFAULT '',
  p_question_type text DEFAULT 'single_choice',
  p_question_text text DEFAULT '',
  p_min_selections integer DEFAULT NULL,
  p_max_selections integer DEFAULT NULL,
  p_char_limit integer DEFAULT NULL,
  p_scoring_mode text DEFAULT 'all_or_nothing'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;

  UPDATE public.questions
  SET question_image = p_question_image,
      instructions = p_instructions,
      external_link = p_external_link,
      question_type = p_question_type,
      question_text = p_question_text,
      min_selections = p_min_selections,
      max_selections = p_max_selections,
      char_limit = p_char_limit,
      scoring_mode = CASE WHEN p_scoring_mode = 'partial_credit' THEN 'partial_credit' ELSE 'all_or_nothing' END
  WHERE id = p_question_id;
END;
$$;

-- 8. Updated save_answer_and_advance: support richer answer formats
CREATE OR REPLACE FUNCTION public.save_answer_and_advance(
  p_attempt_id uuid,
  p_question_id uuid,
  p_selected_option_id uuid,
  p_next_question_index integer,
  p_next_section_index integer,
  p_selected_option_ids jsonb DEFAULT NULL,
  p_text_answer text DEFAULT NULL
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
  v_answer_val jsonb;
BEGIN
  SELECT * INTO v_attempt FROM public.attempts WHERE id = p_attempt_id AND candidate_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attempt not found';
  END IF;
  IF v_attempt.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Test already submitted';
  END IF;

  IF p_selected_option_ids IS NOT NULL THEN
    v_answer_val := p_selected_option_ids;
  ELSIF p_text_answer IS NOT NULL THEN
    v_answer_val := to_jsonb(p_text_answer);
  ELSE
    v_answer_val := CASE WHEN p_selected_option_id IS NULL THEN 'null'::jsonb ELSE to_jsonb(p_selected_option_id) END;
  END IF;

  v_answers := v_attempt.saved_answers;
  v_answers := jsonb_set(v_answers, ARRAY[p_question_id::text], v_answer_val);

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
