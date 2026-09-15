/*
# Fix save_option for multi-select question support

## Overview
Updates the save_option function to check the parent question's type.
For multi_select questions, it no longer clears other correct options
when marking one as correct. For single-choice/dropdown/true_false,
it preserves the original behavior of enforcing a single correct answer.

## Changes
- `save_option`: Checks question_type before clearing other correct options.
  Only clears for single_choice, dropdown, and true_false types.
*/

CREATE OR REPLACE FUNCTION public.save_option(
  p_option_id uuid,
  p_question_id uuid,
  p_option_label text,
  p_option_text text,
  p_is_correct boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_q_type text;
BEGIN
  IF NOT public.has_permission('can-upload-questions') THEN
    RAISE EXCEPTION 'Permission denied: can-upload-questions required';
  END IF;

  SELECT question_type INTO v_q_type FROM public.questions WHERE id = p_question_id;

  IF p_is_correct AND v_q_type IN ('single_choice', 'dropdown', 'true_false') THEN
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

  PERFORM public.log_audit('save_option', 'option', v_id,
    jsonb_build_object('question_id', p_question_id, 'label', p_option_label, 'is_correct', p_is_correct));
  RETURN v_id;
END;
$$;
