/*
# CertifyHub RPC Functions

## Overview
SECURITY DEFINER functions for admin write operations and candidate test submission.
All admin functions check permissions and log audit entries.

## Functions

### Admin: Tests
- `create_test(p_title, p_description, p_pass_mark)` - requires can-manage-tests
- `update_test(p_test_id, p_title, p_description, p_pass_mark, p_status)` - requires can-manage-tests
- `delete_test(p_test_id)` - requires can-manage-tests

### Admin: Sections
- `create_section(p_test_id, p_title, p_timer_minutes, p_instructions)` - requires can-manage-tests
- `update_section(p_section_id, p_title, p_timer_minutes, p_instructions)` - requires can-manage-tests
- `delete_section(p_section_id)` - requires can-manage-tests
- `reorder_sections(p_test_id, p_section_ids[])` - requires can-manage-tests

### Admin: Questions
- `create_question(p_section_id, p_question_image, p_instructions, p_external_link)` - requires can-upload-questions
- `update_question(p_question_id, p_question_image, p_instructions, p_external_link)` - requires can-upload-questions
- `delete_question(p_question_id)` - requires can-upload-questions
- `reorder_questions(p_section_id, p_question_ids[])` - requires can-upload-questions

### Admin: Options
- `save_option(p_question_id, p_option_label, p_option_text, p_is_correct)` - requires can-upload-questions
- `delete_option(p_option_id)` - requires can-upload-questions

### Admin: User Management
- `update_user_status(p_user_id, p_status)` - requires can-manage-users (candidates) or super_admin (admins)
- `delete_user(p_user_id)` - requires can-manage-users (candidates) or super_admin (admins)
- `update_user_name(p_user_id, p_name)` - requires can-manage-users

### Super Admin: Admin Management
- `update_admin_permissions(p_admin_id, p_permissions[])` - super_admin only
- `update_admin_role(p_admin_id, p_role)` - super_admin only

### Candidate
- `submit_attempt(p_test_id, p_answers, p_per_section_time_used)` - scores and stores attempt

## Security
- All functions are SECURITY DEFINER with explicit permission checks
- Every admin write logs to audit_logs
- submit_attempt validates answers server-side (client cannot self-score)
- Functions use auth.uid() to identify the acting user

## Important Notes
1. Functions bypass RLS (SECURITY DEFINER) but enforce permission checks explicitly
2. Audit logging captures admin_id, admin_name, action, entity details
3. submit_attempt does server-side scoring — the client never computes its own score
4. The super_admin bootstrap is handled by an edge function (needs service role key)
*/

-- ============================================================
-- AUDIT LOG HELPER (internal, not exposed)
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_audit(p_action text, p_entity_type text, p_entity_id uuid, p_details jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_name text;
BEGIN
  SELECT name INTO v_admin_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs (admin_id, admin_name, action, entity_type, entity_id, details)
  VALUES (auth.uid(), COALESCE(v_admin_name, ''), p_action, p_entity_type, p_entity_id, p_details);
END;
$$;

-- ============================================================
-- TESTS
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_test(p_title text, p_description text, p_pass_mark integer)
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
  INSERT INTO public.tests (title, description, pass_mark, created_by)
  VALUES (p_title, p_description, p_pass_mark, auth.uid())
  RETURNING id INTO v_test_id;
  PERFORM public.log_audit('create_test', 'test', v_test_id, jsonb_build_object('title', p_title));
  RETURN v_test_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_test(p_test_id uuid, p_title text, p_description text, p_pass_mark integer, p_status text)
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
  SET title = p_title, description = p_description, pass_mark = p_pass_mark, status = p_status
  WHERE id = p_test_id;
  PERFORM public.log_audit('update_test', 'test', p_test_id, jsonb_build_object('title', p_title, 'status', p_status));
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_test(p_test_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;
  SELECT title INTO v_title FROM public.tests WHERE id = p_test_id;
  DELETE FROM public.tests WHERE id = p_test_id;
  PERFORM public.log_audit('delete_test', 'test', p_test_id, jsonb_build_object('title', v_title));
END;
$$;

-- ============================================================
-- SECTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_section(p_test_id uuid, p_title text, p_timer_minutes integer, p_instructions text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_section_id uuid;
  v_max_order integer;
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;
  SELECT COALESCE(MAX(order_index), -1) INTO v_max_order FROM public.sections WHERE test_id = p_test_id;
  INSERT INTO public.sections (test_id, title, timer_minutes, instructions, order_index)
  VALUES (p_test_id, p_title, p_timer_minutes, p_instructions, v_max_order + 1)
  RETURNING id INTO v_section_id;
  PERFORM public.log_audit('create_section', 'section', v_section_id, jsonb_build_object('title', p_title, 'test_id', p_test_id));
  RETURN v_section_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_section(p_section_id uuid, p_title text, p_timer_minutes integer, p_instructions text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;
  UPDATE public.sections
  SET title = p_title, timer_minutes = p_timer_minutes, instructions = p_instructions
  WHERE id = p_section_id;
  PERFORM public.log_audit('update_section', 'section', p_section_id, jsonb_build_object('title', p_title));
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_section(p_section_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;
  SELECT title INTO v_title FROM public.sections WHERE id = p_section_id;
  DELETE FROM public.sections WHERE id = p_section_id;
  PERFORM public.log_audit('delete_section', 'section', p_section_id, jsonb_build_object('title', v_title));
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_sections(p_test_id uuid, p_section_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i integer;
  v_id uuid;
BEGIN
  IF NOT public.has_permission('can-manage-tests') THEN
    RAISE EXCEPTION 'Permission denied: can-manage-tests required';
  END IF;
  FOR i IN 1..array_length(p_section_ids, 1) LOOP
    v_id := p_section_ids[i];
    UPDATE public.sections SET order_index = i - 1 WHERE id = v_id AND test_id = p_test_id;
  END LOOP;
  PERFORM public.log_audit('reorder_sections', 'test', p_test_id, jsonb_build_object('section_ids', p_section_ids));
END;
$$;

-- ============================================================
-- QUESTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_question(p_section_id uuid, p_question_image text, p_instructions text, p_external_link text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_question_id uuid;
  v_max_order integer;
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;
  SELECT COALESCE(MAX(order_index), -1) INTO v_max_order FROM public.questions WHERE section_id = p_section_id;
  INSERT INTO public.questions (section_id, question_image, instructions, external_link, order_index)
  VALUES (p_section_id, p_question_image, p_instructions, p_external_link, v_max_order + 1)
  RETURNING id INTO v_question_id;
  PERFORM public.log_audit('create_question', 'question', v_question_id, jsonb_build_object('section_id', p_section_id));
  RETURN v_question_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_question(p_question_id uuid, p_question_image text, p_instructions text, p_external_link text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;
  UPDATE public.questions
  SET question_image = p_question_image, instructions = p_instructions, external_link = p_external_link
  WHERE id = p_question_id;
  PERFORM public.log_audit('update_question', 'question', p_question_id, jsonb_build_object());
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_question(p_question_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;
  DELETE FROM public.questions WHERE id = p_question_id;
  PERFORM public.log_audit('delete_question', 'question', p_question_id, jsonb_build_object());
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_questions(p_section_id uuid, p_question_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i integer;
  v_id uuid;
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;
  FOR i IN 1..array_length(p_question_ids, 1) LOOP
    v_id := p_question_ids[i];
    UPDATE public.questions SET order_index = i - 1 WHERE id = v_id AND section_id = p_section_id;
  END LOOP;
  PERFORM public.log_audit('reorder_questions', 'section', p_section_id, jsonb_build_object('question_ids', p_question_ids));
END;
$$;

-- ============================================================
-- OPTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_option(p_option_id uuid, p_question_id uuid, p_option_label text, p_option_text text, p_is_correct boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;
  -- If marking this one correct, unmark all others on the same question
  IF p_is_correct THEN
    UPDATE public.options SET is_correct = false WHERE question_id = p_question_id;
  END IF;
  IF p_option_id IS NOT NULL THEN
    UPDATE public.options
    SET option_label = p_option_label, option_text = p_option_text, is_correct = p_is_correct
    WHERE id = p_option_id;
    v_id := p_option_id;
  ELSE
    INSERT INTO public.options (question_id, option_label, option_text, is_correct)
    VALUES (p_question_id, p_option_label, p_option_text, p_is_correct)
    RETURNING id INTO v_id;
  END IF;
  PERFORM public.log_audit('save_option', 'option', v_id, jsonb_build_object('question_id', p_question_id, 'label', p_option_label, 'is_correct', p_is_correct));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_option(p_option_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;
  DELETE FROM public.options WHERE id = p_option_id;
  PERFORM public.log_audit('delete_option', 'option', p_option_id, jsonb_build_object());
END;
$$;

-- ============================================================
-- USER MANAGEMENT
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_user_status(p_user_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_role text;
BEGIN
  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_user_id;
  IF v_target_role IN ('admin', 'super_admin') THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Permission denied: super_admin required to manage admins';
    END IF;
  ELSE
    IF NOT public.has_permission('can-manage-users') THEN
      RAISE EXCEPTION 'Permission denied: can-manage-users required';
    END IF;
  END IF;
  UPDATE public.profiles SET status = p_status WHERE id = p_user_id;
  PERFORM public.log_audit('update_user_status', 'user', p_user_id, jsonb_build_object('status', p_status, 'target_role', v_target_role));
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_role text;
  v_name text;
BEGIN
  SELECT role, name INTO v_target_role, v_name FROM public.profiles WHERE id = p_user_id;
  IF v_target_role IN ('admin', 'super_admin') THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Permission denied: super_admin required to manage admins';
    END IF;
  ELSE
    IF NOT public.has_permission('can-manage-users') THEN
      RAISE EXCEPTION 'Permission denied: can-manage-users required';
    END IF;
  END IF;
  -- Prevent self-deletion
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;
  DELETE FROM public.profiles WHERE id = p_user_id;
  -- auth.users cascade deletes the profile; but we also need to remove the auth user
  -- Note: removing from auth.users requires service role, handled by edge function
  PERFORM public.log_audit('delete_user', 'user', p_user_id, jsonb_build_object('name', v_name, 'role', v_target_role));
END;
$$;

CREATE OR REPLACE FUNCTION public.update_user_name(p_user_id uuid, p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_role text;
BEGIN
  SELECT role INTO v_target_role FROM public.profiles WHERE id = p_user_id;
  IF v_target_role IN ('admin', 'super_admin') THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Permission denied: super_admin required to manage admins';
    END IF;
  ELSE
    IF NOT public.has_permission('can-manage-users') THEN
      RAISE EXCEPTION 'Permission denied: can-manage-users required';
    END IF;
  END IF;
  UPDATE public.profiles SET name = p_name WHERE id = p_user_id;
  PERFORM public.log_audit('update_user_name', 'user', p_user_id, jsonb_build_object('name', p_name));
END;
$$;

-- ============================================================
-- ADMIN MANAGEMENT (super_admin only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_admin_permissions(p_admin_id uuid, p_permissions text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin required';
  END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id = p_admin_id;
  UPDATE public.profiles SET permissions = p_permissions WHERE id = p_admin_id AND role = 'admin';
  PERFORM public.log_audit('update_permissions', 'user', p_admin_id, jsonb_build_object('name', v_name, 'permissions', p_permissions));
END;
$$;

CREATE OR REPLACE FUNCTION public.update_admin_role(p_admin_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: super_admin required';
  END IF;
  IF p_admin_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role';
  END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id = p_admin_id;
  UPDATE public.profiles SET role = p_role WHERE id = p_admin_id;
  PERFORM public.log_audit('update_admin_role', 'user', p_admin_id, jsonb_build_object('name', v_name, 'role', p_role));
END;
$$;

-- ============================================================
-- CANDIDATE: SUBMIT ATTEMPT (server-side scoring)
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_attempt(
  p_test_id uuid,
  p_answers jsonb,
  p_per_section_time_used jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id uuid;
  v_total_questions integer := 0;
  v_correct_answers integer := 0;
  v_score numeric;
  v_pass_mark integer;
  v_pass_fail text;
  v_answer jsonb;
  v_question_id uuid;
  v_selected_option_id uuid;
  v_is_correct boolean;
  v_test_status text;
BEGIN
  -- Verify test is published
  SELECT status INTO v_test_status FROM public.tests WHERE id = p_test_id;
  IF v_test_status IS NULL THEN
    RAISE EXCEPTION 'Test not found';
  END IF;
  IF v_test_status <> 'published' THEN
    RAISE EXCEPTION 'Test is not available';
  END IF;

  -- Count total questions across all sections
  SELECT COUNT(*) INTO v_total_questions
  FROM public.questions q
  JOIN public.sections s ON s.id = q.section_id
  WHERE s.test_id = p_test_id;

  -- Score each answer server-side
  FOR v_answer IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
    v_question_id := (v_answer->>'question_id')::uuid;
    v_selected_option_id := CASE WHEN v_answer->>'selected_option_id' IS NULL THEN NULL ELSE (v_answer->>'selected_option_id')::uuid END;

    IF v_selected_option_id IS NOT NULL THEN
      SELECT is_correct INTO v_is_correct FROM public.options WHERE id = v_selected_option_id AND question_id = v_question_id;
      IF v_is_correct THEN
        v_correct_answers := v_correct_answers + 1;
      END IF;
    END IF;
  END LOOP;

  -- Calculate score as percentage
  IF v_total_questions > 0 THEN
    v_score := ROUND((v_correct_answers::numeric / v_total_questions::numeric) * 100, 2);
  ELSE
    v_score := 0;
  END IF;

  SELECT pass_mark INTO v_pass_mark FROM public.tests WHERE id = p_test_id;
  v_pass_fail := CASE WHEN v_score >= v_pass_mark THEN 'pass' ELSE 'fail' END;

  INSERT INTO public.attempts (
    candidate_id, test_id, submitted_at, per_section_time_used,
    score, pass_or_fail, answers, total_questions, correct_answers
  )
  VALUES (
    auth.uid(), p_test_id, now(), p_per_section_time_used,
    v_score, v_pass_fail, p_answers, v_total_questions, v_correct_answers
  )
  RETURNING id INTO v_attempt_id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id,
    'score', v_score,
    'total_questions', v_total_questions,
    'correct_answers', v_correct_answers,
    'pass_or_fail', v_pass_fail
  );
END;
$$;

-- ============================================================
-- Update last_login trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_last_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET last_login = now() WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_login ON auth.users;
CREATE TRIGGER on_auth_user_login
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW
  WHEN (NEW.last_sign_in_at IS DISTINCT FROM OLD.last_sign_in_at)
  EXECUTE FUNCTION public.update_last_login();
