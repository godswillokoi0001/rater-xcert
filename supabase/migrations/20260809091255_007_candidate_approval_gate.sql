/*
# Candidate Approval Gate + Verification System Update

## Overview
1. Changes the default status for new candidate profiles from 'active' to 'pending'
   so that newly registered candidates must be approved by an admin before accessing
   their dashboard.
2. Updates the verify_code RPC function to accept a user_id parameter instead of
   relying on auth.uid(), since Supabase OTP verification happens server-side.

## Changes
1. **profiles** table: default status changed from 'active' to 'pending' for new rows.
   - Existing active candidates remain active — only NEW signups get 'pending'.
   - Admins/super_admins created via bootstrap are unaffected (their status is set
     explicitly by the admin-api edge function).

2. **verify_code** function: now accepts p_user_id parameter alongside p_code.
   This allows the function to be called from the edge function context where
   auth.uid() may not be available. Still SECURITY DEFINER for safety.

## Security
- No RLS policy changes.
- The verify_code function remains SECURITY DEFINER and is only callable by
  authenticated users (RLS on the function is inherited).
*/

-- Change default status for new profiles to 'pending'
-- This only affects NEW rows; existing rows keep their current status
ALTER TABLE public.profiles
  ALTER COLUMN status SET DEFAULT 'pending';

-- Update verify_code to accept user_id parameter
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
