/*
# CertifyHub Core Schema

## Overview
Creates the foundational database schema for CertifyHub, a certification test platform
with two user roles (candidates and admins) plus a super_admin role.

## New Tables
1. **profiles** - Extends auth.users with role/status/permissions
2. **tests** - Certification exams (title, description, status, pass_mark)
3. **sections** - Timed sections within a test (timer_minutes, order_index, instructions)
4. **questions** - Image-based questions (question_image path, instructions, external_link, order_index)
5. **options** - Multiple-choice options (option_label, option_text, is_correct)
6. **attempts** - Candidate test attempts with scores and answers (jsonb)
7. **audit_logs** - Records every admin action (who did what, when)

## Helper Functions (SECURITY DEFINER)
- `is_admin()` - checks current user is admin/super_admin (active)
- `is_super_admin()` - checks super_admin role
- `has_permission(text)` - checks permission (super_admin always true)
- `handle_new_user()` - trigger creating candidate profile on signup

## Security (RLS)
- profiles: read own or admin; update own (name/last_login)
- tests: read published or admin
- sections/questions/options: read if parent test published or admin
- attempts: read own or admin with can-view-reports
- audit_logs: read admin only
- All writes go through SECURITY DEFINER RPC functions (migration 002)

## Storage
- `question-images` bucket: public read, admin-only write/update/delete

## Important Notes
1. Tables created first, then helper functions, then RLS policies referencing them
2. SECURITY DEFINER functions avoid RLS recursion on profiles
3. Trigger auto-creates candidate profiles on signup
4. Admin writes go through RPC functions with permission checks + audit logging
*/

-- ============================================================
-- TABLES (created first so functions can reference them)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'candidate' CHECK (role IN ('candidate', 'admin', 'super_admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  permissions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login timestamptz
);

CREATE TABLE IF NOT EXISTS public.tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  pass_mark integer NOT NULL DEFAULT 70 CHECK (pass_mark >= 0 AND pass_mark <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  title text NOT NULL,
  timer_minutes integer NOT NULL DEFAULT 30 CHECK (timer_minutes > 0),
  order_index integer NOT NULL DEFAULT 0,
  instructions text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sections_test_id ON public.sections(test_id);
CREATE INDEX IF NOT EXISTS idx_sections_order ON public.sections(test_id, order_index);

CREATE TABLE IF NOT EXISTS public.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
  question_image text NOT NULL DEFAULT '',
  instructions text NOT NULL DEFAULT '',
  external_link text NOT NULL DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_questions_section_id ON public.questions(section_id);
CREATE INDEX IF NOT EXISTS idx_questions_order ON public.questions(section_id, order_index);

CREATE TABLE IF NOT EXISTS public.options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  option_label text NOT NULL DEFAULT '',
  option_text text NOT NULL DEFAULT '',
  is_correct boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_options_question_id ON public.options(question_id);

CREATE TABLE IF NOT EXISTS public.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  per_section_time_used jsonb NOT NULL DEFAULT '{}',
  score numeric NOT NULL DEFAULT 0,
  pass_or_fail text NOT NULL DEFAULT 'fail' CHECK (pass_or_fail IN ('pass', 'fail')),
  answers jsonb NOT NULL DEFAULT '[]',
  total_questions integer NOT NULL DEFAULT 0,
  correct_answers integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attempts_candidate ON public.attempts(candidate_id);
CREATE INDEX IF NOT EXISTS idx_attempts_test ON public.attempts(test_id);
CREATE INDEX IF NOT EXISTS idx_attempts_submitted ON public.attempts(submitted_at);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_name text NOT NULL DEFAULT '',
  action text NOT NULL,
  entity_type text NOT NULL DEFAULT '',
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_admin ON public.audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_logs(entity_type);

-- ============================================================
-- HELPER FUNCTIONS (SECURITY DEFINER, avoid RLS recursion)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
    AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
    AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_perm text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
    AND status = 'active'
    AND (role = 'super_admin' OR permissions @> ARRAY[p_perm])
  );
$$;

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id OR public.is_admin());
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tests_select_published_or_admin" ON public.tests;
CREATE POLICY "tests_select_published_or_admin"
  ON public.tests FOR SELECT
  TO authenticated
  USING (status = 'published' OR public.is_admin());

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sections_select_published_or_admin" ON public.sections;
CREATE POLICY "sections_select_published_or_admin"
  ON public.sections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tests
      WHERE tests.id = sections.test_id
      AND (tests.status = 'published' OR public.is_admin())
    )
  );

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "questions_select_published_or_admin" ON public.questions;
CREATE POLICY "questions_select_published_or_admin"
  ON public.questions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sections
      JOIN public.tests ON tests.id = sections.test_id
      WHERE sections.id = questions.section_id
      AND (tests.status = 'published' OR public.is_admin())
    )
  );

ALTER TABLE public.options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "options_select_published_or_admin" ON public.options;
CREATE POLICY "options_select_published_or_admin"
  ON public.options FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.questions
      JOIN public.sections ON sections.id = questions.section_id
      JOIN public.tests ON tests.id = sections.test_id
      WHERE questions.id = options.question_id
      AND (tests.status = 'published' OR public.is_admin())
    )
  );

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attempts_select_own_or_admin" ON public.attempts;
CREATE POLICY "attempts_select_own_or_admin"
  ON public.attempts FOR SELECT
  TO authenticated
  USING (
    auth.uid() = candidate_id
    OR (public.is_admin() AND public.has_permission('can-view-reports'))
  );

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_admin"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ============================================================
-- TRIGGER: Auto-create candidate profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, status, permissions)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    'candidate',
    'active',
    '{}'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- STORAGE: Question images bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('question-images', 'question-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "question_images_read" ON storage.objects;
CREATE POLICY "question_images_read"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'question-images');

DROP POLICY IF EXISTS "question_images_upload" ON storage.objects;
CREATE POLICY "question_images_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'question-images' AND public.is_admin());

DROP POLICY IF EXISTS "question_images_update" ON storage.objects;
CREATE POLICY "question_images_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'question-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'question-images' AND public.is_admin());

DROP POLICY IF EXISTS "question_images_delete" ON storage.objects;
CREATE POLICY "question_images_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'question-images' AND public.is_admin());
