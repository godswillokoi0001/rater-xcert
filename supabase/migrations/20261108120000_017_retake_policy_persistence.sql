-- ============================================================
-- 017. RETAKE POLICY PERSISTENCE + AUTOMATIC RETAKES
-- ============================================================
-- Problem this fixes
--   The admin "Retake Policy" form (release mode + retakes on failure) never
--   persisted: the deployed database only had the old
--       update_test(uuid, text, text, integer, text, text)
--   signature, so the newer 8/9 parameter calls returned PGRST202 and the app
--   silently fell back to the old call, dropping every retake argument.
--
--   This migration:
--     1. adds the missing retake/target-role columns,
--     2. re-creates user_test_access (blocked/granted overrides),
--     3. drops EVERY update_test/create_test overload and installs ONE
--        unambiguous definition (no more ambiguous-function errors),
--     4. makes can_take_test honour the test-level retake policy,
--     5. makes submit_attempt honour the same policy (or a manual grant),
--     6. reloads the PostgREST schema cache.
--
-- Safe to run more than once.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Retake policy + target role columns
-- ------------------------------------------------------------
ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS retakes_allowed integer NOT NULL DEFAULT 0;

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS retake_on_fail_only boolean NOT NULL DEFAULT true;

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS target_role text NOT NULL DEFAULT 'all';

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tests'::regclass AND conname = 'tests_retakes_allowed_check'
  ) THEN
    ALTER TABLE public.tests
      ADD CONSTRAINT tests_retakes_allowed_check CHECK (retakes_allowed >= -1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tests'::regclass AND conname = 'tests_target_role_check'
  ) THEN
    ALTER TABLE public.tests
      ADD CONSTRAINT tests_target_role_check CHECK (target_role IN ('all', 'candidate', 'worker'));
  END IF;
END
$mig$;

-- ------------------------------------------------------------
-- 2. Backfill from the description metadata tags written by the app
--    (the UI mirrors the policy there until these columns exist)
-- ------------------------------------------------------------
UPDATE public.tests
SET retakes_allowed = CASE
      WHEN description ~* '\[RETAKES:unlimited\]' THEN -1
      WHEN description ~* '\[RETAKES:[0-9]+\]'
        THEN (substring(description from '\[RETAKES:([0-9]+)\]'))::integer
      ELSE retakes_allowed
    END,
    retake_on_fail_only = CASE
      WHEN description ~* '\[RETAKE:ALWAYS\]' THEN false
      WHEN description ~* '\[RETAKE:FAIL_ONLY\]' THEN true
      ELSE retake_on_fail_only
    END,
    target_role = CASE
      WHEN description LIKE '%[ROLE:worker]%' THEN 'worker'
      WHEN description LIKE '%[ROLE:candidate]%' THEN 'candidate'
      ELSE target_role
    END
WHERE description LIKE '%[RETAKES:%'
   OR description LIKE '%[RETAKE:ALWAYS]%'
   OR description LIKE '%[RETAKE:FAIL_ONLY]%'
   OR description LIKE '%[ROLE:worker]%'
   OR description LIKE '%[ROLE:candidate]%';

-- ------------------------------------------------------------
-- 3. Per-user test access overrides (required by can_take_test)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_test_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  access_type text NOT NULL CHECK (access_type IN ('blocked', 'granted')),
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  UNIQUE (user_id, test_id)
);

CREATE INDEX IF NOT EXISTS idx_user_test_access_user ON public.user_test_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_test_access_test ON public.user_test_access(test_id);

ALTER TABLE public.user_test_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access to user_test_access" ON public.user_test_access;
CREATE POLICY "Admins full access to user_test_access"
  ON public.user_test_access FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can read own test access" ON public.user_test_access;
CREATE POLICY "Users can read own test access"
  ON public.user_test_access FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_user_test_access(
  p_user_id uuid,
  p_test_id uuid,
  p_access_type text,
  p_notes text DEFAULT ''
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.has_permission('can-manage-users')
     AND NOT public.has_permission('can-manage-tests')
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin access required';
  END IF;

  IF p_access_type NOT IN ('blocked', 'granted') THEN
    RAISE EXCEPTION 'Invalid access type: %', p_access_type;
  END IF;

  INSERT INTO public.user_test_access (user_id, test_id, access_type, notes, created_by, created_at)
  VALUES (p_user_id, p_test_id, p_access_type, COALESCE(p_notes, ''), auth.uid(), now())
  ON CONFLICT (user_id, test_id)
  DO UPDATE SET
    access_type = EXCLUDED.access_type,
    notes = EXCLUDED.notes,
    created_by = auth.uid(),
    created_at = now();

  PERFORM public.log_audit(
    'set_user_test_access',
    'user_test_access',
    p_test_id,
    jsonb_build_object('user_id', p_user_id, 'access_type', p_access_type, 'notes', p_notes)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.remove_user_test_access(
  p_user_id uuid,
  p_test_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NOT public.has_permission('can-manage-users')
     AND NOT public.has_permission('can-manage-tests')
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin access required';
  END IF;

  DELETE FROM public.user_test_access
  WHERE user_id = p_user_id AND test_id = p_test_id;

  PERFORM public.log_audit(
    'remove_user_test_access',
    'user_test_access',
    p_test_id,
    jsonb_build_object('user_id', p_user_id, 'action', 'reset_to_default')
  );
END;
$fn$;

-- ------------------------------------------------------------
-- 4. Drop every historical update_test / create_test overload
-- ------------------------------------------------------------
DO $mig$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('update_test', 'create_test')
  LOOP
    EXECUTE format('DROP FUNCTION %s', fn.signature);
  END LOOP;
END
$mig$;

-- ------------------------------------------------------------
-- 5. Canonical update_test / create_test (single signature each)
--    All parameters are required on purpose: a caller can never get a
--    "successful" call that silently uses default retake values.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_test(
  p_test_id uuid,
  p_title text,
  p_description text,
  p_pass_mark integer,
  p_status text,
  p_review_mode text,
  p_retakes_allowed integer,
  p_retake_on_fail_only boolean,
  p_target_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pass_mark integer;
  v_review_mode text;
  v_target_role text;
  v_retakes integer;
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;

  v_pass_mark := LEAST(100, GREATEST(0, COALESCE(p_pass_mark, 70)));
  v_review_mode := CASE WHEN p_review_mode = 'immediate' THEN 'immediate' ELSE 'super_admin_approval' END;
  v_target_role := CASE WHEN p_target_role IN ('candidate', 'worker') THEN p_target_role ELSE 'all' END;
  v_retakes := COALESCE(p_retakes_allowed, 0);

  UPDATE public.tests
  SET title = COALESCE(NULLIF(btrim(p_title), ''), title),
      description = COALESCE(p_description, ''),
      pass_mark = v_pass_mark,
      status = CASE WHEN p_status IN ('draft', 'published', 'archived') THEN p_status ELSE status END,
      review_mode = v_review_mode,
      retakes_allowed = v_retakes,
      retake_on_fail_only = COALESCE(p_retake_on_fail_only, true),
      target_role = v_target_role
  WHERE id = p_test_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test not found';
  END IF;

  PERFORM public.log_audit('update_test', 'test', p_test_id,
    jsonb_build_object(
      'title', p_title,
      'status', p_status,
      'pass_mark', v_pass_mark,
      'review_mode', v_review_mode,
      'retakes_allowed', v_retakes,
      'retake_on_fail_only', COALESCE(p_retake_on_fail_only, true),
      'target_role', v_target_role
    )
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.create_test(
  p_title text,
  p_description text,
  p_pass_mark integer,
  p_review_mode text,
  p_retakes_allowed integer,
  p_retake_on_fail_only boolean,
  p_target_role text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_test_id uuid;
  v_pass_mark integer;
  v_review_mode text;
  v_target_role text;
  v_retakes integer;
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'Test title is required';
  END IF;

  v_pass_mark := LEAST(100, GREATEST(0, COALESCE(p_pass_mark, 70)));
  v_review_mode := CASE WHEN p_review_mode = 'immediate' THEN 'immediate' ELSE 'super_admin_approval' END;
  v_target_role := CASE WHEN p_target_role IN ('candidate', 'worker') THEN p_target_role ELSE 'all' END;
  v_retakes := COALESCE(p_retakes_allowed, 0);

  INSERT INTO public.tests (
    title, description, pass_mark, review_mode, status, created_by,
    retakes_allowed, retake_on_fail_only, target_role
  )
  VALUES (
    btrim(p_title),
    COALESCE(p_description, ''),
    v_pass_mark,
    v_review_mode,
    'draft',
    auth.uid(),
    v_retakes,
    COALESCE(p_retake_on_fail_only, true),
    v_target_role
  )
  RETURNING id INTO v_test_id;

  PERFORM public.log_audit('create_test', 'test', v_test_id,
    jsonb_build_object(
      'title', p_title,
      'pass_mark', v_pass_mark,
      'review_mode', v_review_mode,
      'retakes_allowed', v_retakes,
      'retake_on_fail_only', COALESCE(p_retake_on_fail_only, true),
      'target_role', v_target_role
    )
  );

  RETURN v_test_id;
END;
$fn$;

-- ------------------------------------------------------------
-- 6. can_take_test: test-level retake policy + manual grants
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_take_test(p_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_test record;
  v_override record;
  v_unlock record;
  v_user_role text;
  v_user_permissions text[];
  v_is_worker boolean;
  v_is_worker_test boolean;
  v_unreleased boolean;
  v_released_count integer;
  v_latest record;
  v_policy integer;
  v_fail_only boolean;
  v_can boolean := false;
  v_remaining integer := 0;
  v_reason text := NULL;
BEGIN
  SELECT * INTO v_test FROM public.tests WHERE id = p_test_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_take', false, 'reason', 'Test not found', 'retakes_remaining', 0);
  END IF;

  IF v_test.status <> 'published' THEN
    RETURN jsonb_build_object('can_take', false, 'reason', 'Test is not published', 'retakes_remaining', 0);
  END IF;

  -- Individual block/grant overrides win over the role rules.
  SELECT * INTO v_override
  FROM public.user_test_access
  WHERE user_id = auth.uid() AND test_id = p_test_id;

  IF FOUND THEN
    IF v_override.access_type = 'blocked' THEN
      RETURN jsonb_build_object(
        'can_take', false,
        'reason', 'Access to this assessment has been blocked for your account by an administrator.',
        'retakes_remaining', 0
      );
    END IF;
  ELSE
    SELECT role, permissions INTO v_user_role, v_user_permissions
    FROM public.profiles WHERE id = auth.uid();

    v_is_worker := (v_user_role = 'worker')
      OR COALESCE('worker' = ANY(v_user_permissions), false);
    v_is_worker_test := (v_test.target_role = 'worker' OR v_test.description LIKE '%[ROLE:worker]%');

    IF v_is_worker AND NOT v_is_worker_test THEN
      RETURN jsonb_build_object('can_take', false, 'reason', 'This assessment is reserved for candidates.', 'retakes_remaining', 0);
    END IF;

    IF COALESCE(v_user_role, '') = 'candidate' AND NOT v_is_worker AND v_is_worker_test THEN
      RETURN jsonb_build_object('can_take', false, 'reason', 'This test is reserved for verified workers.', 'retakes_remaining', 0);
    END IF;
  END IF;

  -- A submitted attempt that has not been released blocks everything.
  SELECT EXISTS (
    SELECT 1 FROM public.attempts
    WHERE candidate_id = auth.uid()
      AND test_id = p_test_id
      AND submitted_at IS NOT NULL
      AND review_status IN ('pending_review', 'reviewed')
  ) INTO v_unreleased;

  IF v_unreleased THEN
    RETURN jsonb_build_object(
      'can_take', false,
      'reason', 'Your previous attempt is awaiting admin review.',
      'retakes_remaining', 0
    );
  END IF;

  SELECT COUNT(*) INTO v_released_count
  FROM public.attempts
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id
    AND review_status = 'released';

  IF v_released_count = 0 THEN
    v_policy := COALESCE(v_test.retakes_allowed, 0);
    RETURN jsonb_build_object(
      'can_take', true,
      'reason', NULL,
      'retakes_remaining', CASE WHEN v_policy = -1 THEN 999 ELSE GREATEST(0, v_policy) END
    );
  END IF;

  SELECT * INTO v_latest
  FROM public.attempts
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id
    AND review_status = 'released'
  ORDER BY COALESCE(submitted_at, started_at) DESC
  LIMIT 1;

  v_policy := COALESCE(v_test.retakes_allowed, 0);
  v_fail_only := COALESCE(v_test.retake_on_fail_only, true);

  IF v_policy = -1 THEN
    IF NOT v_fail_only OR v_latest.pass_or_fail = 'fail' THEN
      v_can := true;
      v_remaining := 999;
    END IF;
  ELSIF v_policy > 0 THEN
    IF (v_released_count - 1) < v_policy
       AND (NOT v_fail_only OR v_latest.pass_or_fail = 'fail') THEN
      v_can := true;
      v_remaining := v_policy - (v_released_count - 1);
    END IF;
  END IF;

  -- Manual admin grant still works even when the policy says no.
  IF NOT v_can THEN
    SELECT * INTO v_unlock
    FROM public.test_unlocks
    WHERE candidate_id = auth.uid() AND test_id = p_test_id;

    IF FOUND AND COALESCE(v_unlock.retakes_used, 0) < COALESCE(v_unlock.retakes_allowed, 0) THEN
      v_can := true;
      v_remaining := GREATEST(v_remaining, COALESCE(v_unlock.retakes_allowed, 0) - COALESCE(v_unlock.retakes_used, 0));
    END IF;
  END IF;

  IF v_can THEN
    RETURN jsonb_build_object('can_take', true, 'reason', NULL, 'retakes_remaining', v_remaining);
  END IF;

  v_reason := CASE
    WHEN v_latest.pass_or_fail = 'pass' AND v_fail_only THEN 'You have already passed this test.'
    WHEN v_policy = 0 THEN 'You have already taken this test. Retakes are not enabled for this test.'
    ELSE 'You have reached the maximum number of retakes for this test.'
  END;

  RETURN jsonb_build_object('can_take', false, 'reason', v_reason, 'retakes_remaining', 0);
END;
$fn$;

-- ------------------------------------------------------------
-- 7. submit_attempt: enforce the same retake policy server-side
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_attempt(
  p_test_id uuid,
  p_answers jsonb,
  p_per_section_time_used jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  v_policy integer;
  v_fail_only boolean;
  v_released_count integer;
  v_latest record;
  v_policy_allows boolean;
  v_manual_unlock_used boolean := false;
BEGIN
  SELECT status, review_mode, pass_mark, retakes_allowed, retake_on_fail_only
    INTO v_test_status, v_review_mode, v_pass_mark, v_policy, v_fail_only
  FROM public.tests
  WHERE id = p_test_id;

  IF v_test_status IS NULL THEN
    RAISE EXCEPTION 'Test not found';
  END IF;
  IF v_test_status <> 'published' THEN
    RAISE EXCEPTION 'Test is not available';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('candidate', 'worker')
      AND status = 'active'
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

  -- Retake gate: test policy first, manual grant second.
  SELECT COUNT(*) INTO v_released_count
  FROM public.attempts
  WHERE candidate_id = auth.uid()
    AND test_id = p_test_id
    AND review_status = 'released';

  IF v_released_count > 0 THEN
    SELECT * INTO v_latest
    FROM public.attempts
    WHERE candidate_id = auth.uid()
      AND test_id = p_test_id
      AND review_status = 'released'
    ORDER BY COALESCE(submitted_at, started_at) DESC
    LIMIT 1;

    v_policy := COALESCE(v_policy, 0);
    v_fail_only := COALESCE(v_fail_only, true);

    v_policy_allows := CASE
      WHEN v_policy = -1 THEN (NOT v_fail_only OR v_latest.pass_or_fail = 'fail')
      WHEN v_policy > 0 THEN ((v_released_count - 1) < v_policy AND (NOT v_fail_only OR v_latest.pass_or_fail = 'fail'))
      ELSE false
    END;

    IF NOT v_policy_allows THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.test_unlocks
        WHERE candidate_id = auth.uid()
          AND test_id = p_test_id
          AND retakes_used < retakes_allowed
      ) THEN
        RAISE EXCEPTION 'You have already taken this test and no retake is available.';
      END IF;
      v_manual_unlock_used := true;
    END IF;
  END IF;

  v_review_status := CASE WHEN v_review_mode = 'immediate' THEN 'released' ELSE 'pending_review' END;

  SELECT COUNT(*) INTO v_total_questions
  FROM public.questions q
  JOIN public.sections s ON s.id = q.section_id
  WHERE s.test_id = p_test_id;

  -- Only auto-scorable questions count toward the automatic score.
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
          IF v_total_correct > 0 THEN
            v_partial_score := v_partial_score
              + GREATEST(0, (v_correct_count::numeric - v_wrong_count::numeric) / v_total_correct::numeric);
          END IF;
        END IF;
      END IF;
    ELSE
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

  v_pass_mark := COALESCE(v_pass_mark, 70);
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

  -- Consume exactly one manual retake grant when that is what allowed the attempt.
  IF v_manual_unlock_used THEN
    UPDATE public.test_unlocks
    SET retakes_used = retakes_used + 1
    WHERE candidate_id = auth.uid()
      AND test_id = p_test_id
      AND retakes_used < retakes_allowed;
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'review_status', v_review_status,
    'review_mode', v_review_mode,
    'score', v_score,
    'pass_or_fail', v_pass_fail,
    'correct_answers', v_correct_answers,
    'total_questions', v_scorable_questions
  );
END;
$fn$;

-- ------------------------------------------------------------
-- 8. Permissions + schema cache reload
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.update_test(uuid, text, text, integer, text, text, integer, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_test(text, text, integer, text, integer, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_take_test(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_attempt(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_test_access(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_user_test_access(uuid, uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
