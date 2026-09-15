/*
# Fix Candidate Approval Gate + Verification Flow

## Overview
Fixes the candidate approval and email verification flow:

1. The `handle_new_user` trigger inserted profiles with status `'pending_approval'`
   but the frontend checks for `'pending'`. This adds `'pending'` to the allowed
   status values and updates the trigger to use it.

2. Existing candidate profiles created before the gate have `email_verified = true`
   and `status = 'active'`, so they skip verification and approval. This resets all
   existing candidates to require verification and approval.

3. The `verify_code` function's search_path is normalized to `public`.

## Changes
1. **profiles** table: status check constraint updated to include `'pending'`.
2. **handle_new_user** function: status changed from `'pending_approval'` to `'pending'`.
3. Existing candidate profiles: `email_verified` reset to `false`, `status` reset to
   `'pending'` so they go through the full flow.
4. **verify_code** function: search_path normalized.
*/

-- Drop old status check and add new one that includes 'pending'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_status_check
  CHECK (status = ANY (ARRAY['active', 'disabled', 'pending', 'pending_approval', 'rejected']));

-- Fix the handle_new_user trigger function to use 'pending' status
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, status, permissions, email_verified)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    'candidate',
    'pending',
    '{}',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Reset existing candidates to require verification + approval
-- Admins and super_admins are NOT affected
UPDATE public.profiles
SET email_verified = false,
    status = 'pending'
WHERE role = 'candidate';

-- Normalize verify_code search_path
CREATE OR REPLACE FUNCTION public.verify_code(p_user_id uuid, p_code text)
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
  WHERE user_id = p_user_id
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

  UPDATE public.profiles
  SET email_verified = true
  WHERE id = p_user_id;

  RETURN true;
END;
$$;
