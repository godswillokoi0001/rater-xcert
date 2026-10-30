-- ============================================================
-- FIX TEST PUBLISHING & AMBIGUOUS FUNCTION OVERLOADS
-- AND ENABLE USER TEST ACCESS BLOCKING & RELEASING
-- ============================================================

-- 1. DROP AMBIGUOUS HISTORICAL FUNCTIONS
DROP FUNCTION IF EXISTS public.update_test(uuid, text, text, integer, text);
DROP FUNCTION IF EXISTS public.create_test(text, text, integer);

-- 2. ENSURE tests TABLE HAS target_role
ALTER TABLE public.tests ADD COLUMN IF NOT EXISTS target_role text NOT NULL DEFAULT 'all'
  CHECK (target_role IN ('all', 'candidate', 'worker'));

-- 3. CREATE user_test_access TABLE FOR USER-SPECIFIC OVERRIDES
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
  ON public.user_test_access
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can read own test access" ON public.user_test_access;
CREATE POLICY "Users can read own test access"
  ON public.user_test_access
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 4. RPC TO SET USER TEST ACCESS (BLOCK OR GRANT)
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
  IF NOT public.has_permission('can-manage-users') AND NOT public.has_permission('can-manage-tests') AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin access required';
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

GRANT EXECUTE ON FUNCTION public.set_user_test_access(uuid, uuid, text, text) TO authenticated;

-- 5. RPC TO REMOVE USER TEST ACCESS (RESET TO DEFAULT)
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
  IF NOT public.has_permission('can-manage-users') AND NOT public.has_permission('can-manage-tests') AND NOT public.is_admin() THEN
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
$$;

GRANT EXECUTE ON FUNCTION public.remove_user_test_access(uuid, uuid) TO authenticated;

-- 6. CAN_TAKE_TEST FUNCTION ENFORCING INDIVIDUAL OVERRIDES
CREATE OR REPLACE FUNCTION public.can_take_test(p_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_test record;
  v_override record;
  v_user_role text;
  v_is_worker boolean;
  v_is_worker_test boolean;
  v_attempts_count integer;
  v_passed boolean;
  v_retakes_allowed integer;
  v_retake_on_fail_only boolean;
BEGIN
  SELECT * INTO v_test FROM public.tests WHERE id = p_test_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_take', false, 'reason', 'Test not found');
  END IF;

  IF v_test.status != 'published' THEN
    RETURN jsonb_build_object('can_take', false, 'reason', 'Test is not published');
  END IF;

  -- Check explicit individual user access override first
  SELECT * INTO v_override FROM public.user_test_access
  WHERE user_id = auth.uid() AND test_id = p_test_id;

  IF FOUND THEN
    IF v_override.access_type = 'blocked' THEN
      RETURN jsonb_build_object('can_take', false, 'reason', 'Access to this assessment has been blocked for your account by an administrator.');
    END IF;
  ELSE
    -- Role compatibility
    SELECT role, ('worker' = ANY(permissions)) INTO v_user_role, v_is_worker
    FROM public.profiles WHERE id = auth.uid();

    v_is_worker_test := (v_test.target_role = 'worker' OR v_test.description LIKE '%[ROLE:worker]%');

    IF (v_user_role = 'worker' OR v_is_worker) AND NOT v_is_worker_test THEN
      RETURN jsonb_build_object('can_take', false, 'reason', 'This assessment is reserved for candidates.');
    END IF;

    IF (v_user_role = 'candidate' AND NOT v_is_worker) AND v_is_worker_test THEN
      RETURN jsonb_build_object('can_take', false, 'reason', 'This test is reserved for verified workers.');
    END IF;
  END IF;

  -- Attempts and retakes
  SELECT COUNT(*), bool_or(passed) INTO v_attempts_count, v_passed
  FROM public.attempts
  WHERE candidate_id = auth.uid() AND test_id = p_test_id AND status != 'abandoned';

  v_retakes_allowed := COALESCE(v_test.retakes_allowed, 0);
  v_retake_on_fail_only := COALESCE(v_test.retake_on_fail_only, true);

  IF v_attempts_count > 0 THEN
    IF v_passed AND v_retake_on_fail_only THEN
      RETURN jsonb_build_object('can_take', false, 'reason', 'You have already passed this test.');
    END IF;

    IF v_retakes_allowed != -1 AND v_attempts_count > v_retakes_allowed THEN
      RETURN jsonb_build_object('can_take', false, 'reason', 'Maximum attempt limit reached.');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'can_take', true,
    'reason', null,
    'retakes_remaining', CASE WHEN v_retakes_allowed = -1 THEN -1 ELSE GREATEST(0, v_retakes_allowed - v_attempts_count + 1) END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_take_test(uuid) TO authenticated;
