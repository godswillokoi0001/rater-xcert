-- Migration 015: Allow Admins to update user role between candidate and worker

CREATE OR REPLACE FUNCTION public.update_user_role(p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_role NOT IN ('candidate', 'worker') THEN
    RAISE EXCEPTION 'Invalid role. Only candidate or worker can be updated via this function.';
  END IF;

  SELECT name INTO v_name FROM public.profiles WHERE id = p_user_id;

  UPDATE public.profiles
  SET role = p_role
  WHERE id = p_user_id;

  PERFORM public.log_audit('update_user_role', 'user', p_user_id, jsonb_build_object('name', v_name, 'role', p_role));
END;
$$;

