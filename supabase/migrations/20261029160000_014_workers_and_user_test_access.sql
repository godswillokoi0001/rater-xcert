/*
# Migration 014: Worker Role, Test Target Audience, and User Test Access Controls

## Overview
1. Adds 'worker' to public.profiles role constraint
2. Updates handle_new_user() trigger to set worker role from user_metadata
3. Adds target_role ('all', 'candidate', 'worker') to public.tests
4. Creates public.user_test_access table for individual test blocking and releasing
5. Adds RPC functions: set_user_test_access, remove_user_test_access
6. Updates create_test and update_test to accept target_role
7. Updates can_take_test to enforce individual blocks/grants and target_role rules
*/

-- 1. Update profiles role check constraint to include 'worker'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('candidate', 'worker', 'admin', 'super_admin'));

-- 2. Update handle_new_user() trigger function to accept 'worker' from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'candidate');
  IF v_role NOT IN ('candidate', 'worker') THEN
    v_role := 'candidate';
  END IF;

  INSERT INTO public.profiles (id, name, role, status, permissions, email_verified)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    v_role,
    'pending',
    '{}',
    false
  )
  ON CONFLICT (id) DO UPDATE
    SET role = CASE WHEN public.profiles.role IN ('admin', 'super_admin') THEN public.profiles.role ELSE EXCLUDED.role END;

  RETURN NEW;
END;
$$;

-- 3. Add target_role to public.tests
ALTER TABLE public.tests ADD COLUMN IF NOT EXISTS target_role text NOT NULL DEFAULT 'all'
  CHECK (target_role IN ('all', 'candidate', 'worker'));

-- 4. Create user_test_access table for individual test blocking and releasing
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

ALTER TABLE public.user_test_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to user_test_access"
  ON public.user_test_access
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Users can read own test access"
  ON public.user_test_access
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 5. Helper RPC to set or remove user test access
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
AS $$
BEGIN
  IF NOT public.has_permission('can-manage-users') AND NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  INSERT INTO public.user_test_access (user_id, test_id, access_type, notes, created_by, created_at)
  VALUES (p_user_id, p_test_id, p_access_type, p_notes, auth.uid(), now())
  ON CONFLICT (user_id, test_id)
  DO UPDATE SET
    access_type = p_access_type,
    notes = p_notes,
    created_by = auth.uid(),
    created_at = now();

  PERFORM public.log_audit(
    'set_user_test_access',
    'user_test_access',
    p_test_id,
    jsonb_build_object('user_id', p_user_id, 'access_type', p_access_type, 'notes', p_notes)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_user_test_access(
  p_user_id uuid,
  p_test_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('can-manage-users') AND NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied';
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
$$;

-- 6. Update create_test and update_test to accept target_role
CREATE OR REPLACE FUNCTION public.create_test(
  p_title text,
  p_description text DEFAULT '',
  p_pass_mark integer DEFAULT 70,
  p_review_mode text DEFAULT 'super_admin_approval',
  p_retakes_allowed integer DEFAULT 0,
  p_retake_on_fail_only boolean DEFAULT true,
  p_target_role text DEFAULT 'all'
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
    retakes_allowed, retake_on_fail_only, target_role
  )
  VALUES (
    p_title, p_description, p_pass_mark,
    CASE WHEN p_review_mode = 'immediate' THEN 'immediate' ELSE 'super_admin_approval' END,
    'draft', auth.uid(),
    p_retakes_allowed, p_retake_on_fail_only,
    CASE WHEN p_target_role IN ('candidate', 'worker') THEN p_target_role ELSE 'all' END
  )
  RETURNING id INTO v_test_id;

  PERFORM public.log_audit('create_test', 'test', v_test_id,
    jsonb_build_object(
      'title', p_title,
      'pass_mark', p_pass_mark,
      'review_mode', p_review_mode,
      'retakes_allowed', p_retakes_allowed,
      'retake_on_fail_only', p_retake_on_fail_only,
      'target_role', p_target_role
    )
  );

  RETURN v_test_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_test(
  p_test_id uuid,
  p_title text,
  p_description text DEFAULT '',
  p_pass_mark integer DEFAULT 70,
  p_status text DEFAULT 'draft',
  p_review_mode text DEFAULT 'super_admin_approval',
  p_retakes_allowed integer DEFAULT 0,
  p_retake_on_fail_only boolean DEFAULT true,
  p_target_role text DEFAULT 'all'
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
      retake_on_fail_only = p_retake_on_fail_only,
      target_role = CASE WHEN p_target_role IN ('candidate', 'worker') THEN p_target_role ELSE 'all' END
  WHERE id = p_test_id;

  PERFORM public.log_audit('update_test', 'test', p_test_id,
    jsonb_build_object(
      'title', p_title,
      'status', p_status,
      'pass_mark', p_pass_mark,
      'review_mode', p_review_mode,
      'retakes_allowed', p_retakes_allowed,
      'retake_on_fail_only', p_retake_on_fail_only,
      'target_role', p_target_role
    )
  );
END;
$$;

-- 7. Update can_take_test: respects user_test_access (blocked/granted) & target_role
CREATE OR REPLACE FUNCTION public.can_take_test(p_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_test record;
  v_user record;
  v_user_access record;
  v_has_unreleased boolean;
  v_latest_attempt record;
  v_completed_count integer := 0;
  v_unlock record;
  v_can_retake boolean := false;
  v_retakes_left integer := 0;
BEGIN
  -- Fetch test settings
  SELECT * INTO v_test FROM public.tests WHERE id = p_test_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_take', false, 'reason', 'Test not found', 'retakes_remaining', 0);
  END IF;

  -- Fetch user profile
  SELECT * INTO v_user FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_take', false, 'reason', 'User profile not found', 'retakes_remaining', 0);
  END IF;

  -- Check individual user test access overrides
  SELECT * INTO v_user_access FROM public.user_test_access WHERE user_id = auth.uid() AND test_id = p_test_id;

  IF v_user_access IS NOT NULL THEN
    IF v_user_access.access_type = 'blocked' THEN
      RETURN jsonb_build_object(
        'can_take', false,
        'reason', 'Access to this test has been blocked for your account by an administrator.',
        'retakes_remaining', 0
      );
    END IF;
    -- If granted, it bypasses role restrictions
  ELSE
    -- If no override, enforce target_role
    IF v_test.target_role = 'candidate' AND v_user.role <> 'candidate' THEN
      RETURN jsonb_build_object(
        'can_take', false,
        'reason', 'This test is available for candidate accounts only.',
        'retakes_remaining', 0
      );
    ELSIF v_test.target_role = 'worker' AND v_user.role <> 'worker' THEN
      RETURN jsonb_build_object(
        'can_take', false,
        'reason', 'This test is available for worker accounts only.',
        'retakes_remaining', 0
      );
    END IF;
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
    IF NOT v_test.retake_on_fail_only OR v_latest_attempt.pass_or_fail = 'fail' THEN
      v_can_retake := true;
      v_retakes_left := 999;
    END IF;
  ELSIF v_test.retakes_allowed > 0 THEN
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

  IF v_can_retake THEN
    RETURN jsonb_build_object(
      'can_take', true,
      'reason', NULL,
      'retakes_remaining', v_retakes_left
    );
  END IF;

  RETURN jsonb_build_object(
    'can_take', false,
    'reason', CASE
      WHEN v_latest_attempt.pass_or_fail = 'pass' THEN 'You have already passed this test.'
      ELSE 'You have reached the maximum number of attempts allowed for this test.'
    END,
    'retakes_remaining', 0
  );
END;
$$;
