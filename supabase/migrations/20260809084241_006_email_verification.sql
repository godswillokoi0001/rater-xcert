/*
# Email Verification for All User Roles

## Overview
Adds an `email_verified` column to profiles and updates the `verify_code` RPC
function to mark the user's email as verified when a correct code is submitted.

## Changes
1. **profiles** table: new `email_verified boolean NOT NULL DEFAULT false`
   - Tracks whether the user has completed email verification after sign-up/sign-in.
   - All roles (candidate, admin, super_admin) must verify before accessing the app.

2. **verify_code** function updated: on successful code verification, sets
   `email_verified = true` on the user's profile.

## Security
- No RLS policy changes — profiles already have SELECT/UPDATE policies.
- The `verify_code` function is SECURITY DEFINER and uses `auth.uid()` for ownership.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.verify_code(p_code text)
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
  WHERE user_id = auth.uid()
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
  WHERE id = auth.uid();

  RETURN true;
END;
$$;
