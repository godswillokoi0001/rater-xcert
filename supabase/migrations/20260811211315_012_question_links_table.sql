/*
# Multiple External Links per Question

## Overview
Adds a `question_links` table so admins can attach one or more external reference links
to a single question. Each link has an optional label (e.g. "Datasheet", "API Docs")
and a URL. The existing `questions.external_link` column is kept for backward
compatibility — the app will read from the new table going forward.

## New Tables
1. **question_links** - One or more links per question
   - id (uuid, primary key)
   - question_id (uuid, FK to questions, cascade delete)
   - url (text, not null) - the fully-qualified URL (https://...)
   - label (text, default '') - optional display label
   - order_index (int, default 0) - display ordering
   - created_at (timestamptz)

## New RPC Functions (SECURITY DEFINER, can-upload-questions required)
- `save_question_link` - insert or update a single link for a question
- `delete_question_link` - delete a single link by id

## Security (RLS)
- question_links: SELECT when parent test is published or caller is admin
  (mirrors the existing questions policy)
- All writes go through SECURITY DEFINER RPC functions with permission checks

## Important Notes
1. The table is created idempotently (IF NOT EXISTS).
2. Policies are dropped before recreate to stay idempotent.
3. No data migration is performed — old external_link values remain in place
   and the app will fall back to showing them if no question_links rows exist.
*/

CREATE TABLE IF NOT EXISTS public.question_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  url text NOT NULL,
  label text NOT NULL DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_question_links_question_id ON public.question_links(question_id);
CREATE INDEX IF NOT EXISTS idx_question_links_order ON public.question_links(question_id, order_index);

ALTER TABLE public.question_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "question_links_select_published_or_admin" ON public.question_links;
CREATE POLICY "question_links_select_published_or_admin"
  ON public.question_links FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.questions
      JOIN public.sections ON sections.id = questions.section_id
      JOIN public.tests ON tests.id = sections.test_id
      WHERE questions.id = question_links.question_id
      AND (tests.status = 'published' OR public.is_admin())
    )
  );

-- save_question_link: insert or update a link
CREATE OR REPLACE FUNCTION public.save_question_link(
  p_link_id uuid DEFAULT NULL,
  p_question_id uuid DEFAULT NULL,
  p_url text DEFAULT '',
  p_label text DEFAULT '',
  p_order_index integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link_id uuid;
  v_question_id uuid;
  v_next_order integer;
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;

  v_question_id := COALESCE(p_question_id, (SELECT question_id FROM public.question_links WHERE id = p_link_id));
  IF v_question_id IS NULL THEN
    RAISE EXCEPTION 'question_id is required for new links';
  END IF;

  IF p_link_id IS NOT NULL THEN
    UPDATE public.question_links
    SET url = p_url, label = p_label, order_index = p_order_index
    WHERE id = p_link_id;
    v_link_id := p_link_id;
  ELSE
    SELECT COALESCE(MAX(order_index), -1) + 1 INTO v_next_order
    FROM public.question_links WHERE question_id = v_question_id;

    INSERT INTO public.question_links (question_id, url, label, order_index)
    VALUES (v_question_id, p_url, p_label, COALESCE(p_order_index, v_next_order))
    RETURNING id INTO v_link_id;
  END IF;

  RETURN v_link_id;
END;
$$;

-- delete_question_link: delete a link by id
CREATE OR REPLACE FUNCTION public.delete_question_link(
  p_link_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;

  DELETE FROM public.question_links WHERE id = p_link_id;
END;
$$;