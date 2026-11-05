-- Allow an administrator who has explicitly been granted can-manage-admins
-- to update permissions for other administrator accounts.
CREATE OR REPLACE FUNCTION public.update_admin_permissions(p_admin_id uuid, p_permissions text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT public.has_permission('can-manage-admins') THEN
    RAISE EXCEPTION 'Permission denied: admin management permission required';
  END IF;

  SELECT name INTO v_name
  FROM public.profiles
  WHERE id = p_admin_id AND role = 'admin';

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Administrator not found';
  END IF;

  UPDATE public.profiles
  SET permissions = COALESCE(p_permissions, '{}'::text[])
  WHERE id = p_admin_id AND role = 'admin';

  PERFORM public.log_audit(
    'update_permissions',
    'user',
    p_admin_id,
    jsonb_build_object('name', v_name, 'permissions', p_permissions)
  );
END;
$$;
