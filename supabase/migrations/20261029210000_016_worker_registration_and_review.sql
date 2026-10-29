-- Migration 016: Ensure worker registration triggers and role management

-- 1. Ensure profiles_role_check constraint allows 'worker'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('candidate', 'worker', 'admin', 'super_admin'));

-- 2. Update handle_new_user() trigger function to respect worker role in metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_name text;
BEGIN
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'candidate');
  IF v_role NOT IN ('candidate', 'worker') THEN
    v_role := 'candidate';
  END IF;

  v_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, name, role, status, permissions, email_verified)
  VALUES (
    NEW.id,
    v_name,
    v_role,
    'pending',
    '{}',
    false
  )
  ON CONFLICT (id) DO UPDATE
    SET
      role = CASE
        WHEN public.profiles.role IN ('admin', 'super_admin') THEN public.profiles.role
        ELSE EXCLUDED.role
      END,
      name = CASE
        WHEN public.profiles.name IS NULL OR public.profiles.name = '' THEN EXCLUDED.name
        ELSE public.profiles.name
      END;

  RETURN NEW;
END;
$$;

-- 3. Allow authenticated users to claim their role if specified in user_metadata
CREATE OR REPLACE FUNCTION public.claim_my_role(p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_role IN ('candidate', 'worker') THEN
    UPDATE public.profiles
    SET role = p_role
    WHERE id = auth.uid()
      AND role IN ('candidate', 'worker');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_my_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_role(text) TO anon;

-- 4. Update update_user_role function
CREATE OR REPLACE FUNCTION public.update_user_role(
  p_user_id uuid,
  p_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only administrators can update user roles';
  END IF;

  IF p_role NOT IN ('candidate', 'worker') THEN
    RAISE EXCEPTION 'Target role must be either candidate or worker';
  END IF;

  SELECT name INTO v_name FROM public.profiles WHERE id = p_user_id;

  UPDATE public.profiles
  SET role = p_role
  WHERE id = p_user_id
    AND role IN ('candidate', 'worker');

  INSERT INTO public.audit_logs (actor_id, actor_email, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    auth.email(),
    'update_user_role',
    'user',
    p_user_id,
    jsonb_build_object('name', v_name, 'new_role', p_role)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_role(uuid, text) TO authenticated;
