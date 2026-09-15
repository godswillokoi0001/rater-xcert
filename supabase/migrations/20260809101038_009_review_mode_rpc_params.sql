-- Add review_mode parameter to create_test and update_test RPC functions
-- so admins can control per-test score release behavior from the UI.

CREATE OR REPLACE FUNCTION public.create_test(
  p_title text,
  p_description text,
  p_pass_mark integer,
  p_review_mode text DEFAULT 'super_admin_approval'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_test_id uuid;
  v_mode text;
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;
  v_mode := CASE WHEN p_review_mode = 'immediate' THEN 'immediate' ELSE 'super_admin_approval' END;
  INSERT INTO public.tests (title, description, pass_mark, created_by, review_mode)
  VALUES (p_title, p_description, p_pass_mark, auth.uid(), v_mode)
  RETURNING id INTO v_test_id;
  PERFORM public.log_audit('create_test', 'test', v_test_id, jsonb_build_object('title', p_title, 'review_mode', v_mode));
  RETURN v_test_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_test(
  p_test_id uuid,
  p_title text,
  p_description text,
  p_pass_mark integer,
  p_status text,
  p_review_mode text DEFAULT 'super_admin_approval'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;
  v_mode := CASE WHEN p_review_mode = 'immediate' THEN 'immediate' ELSE 'super_admin_approval' END;
  UPDATE public.tests
  SET title = p_title, description = p_description, pass_mark = p_pass_mark, status = p_status, review_mode = v_mode
  WHERE id = p_test_id;
  PERFORM public.log_audit('update_test', 'test', p_test_id, jsonb_build_object('title', p_title, 'status', p_status, 'review_mode', v_mode));
END;
$$;
