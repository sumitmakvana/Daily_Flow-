
-- comments
CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  parent_comment_id uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
GRANT ALL ON public.comments TO service_role;

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY comments_read ON public.comments FOR SELECT TO authenticated USING (true);

CREATE POLICY comments_insert ON public.comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY comments_update_own ON public.comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (user_id = auth.uid());

CREATE POLICY comments_delete_own_or_mgr ON public.comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_or_admin(auth.uid()));

CREATE INDEX idx_comments_work_item ON public.comments(work_item_id, created_at);
CREATE INDEX idx_comments_parent ON public.comments(parent_comment_id);

-- mentions
CREATE TABLE public.comment_mentions (
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  mentioned_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, mentioned_user_id)
);

GRANT SELECT, INSERT, DELETE ON public.comment_mentions TO authenticated;
GRANT ALL ON public.comment_mentions TO service_role;

ALTER TABLE public.comment_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_read ON public.comment_mentions FOR SELECT TO authenticated USING (true);
CREATE POLICY cm_insert ON public.comment_mentions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_id AND c.user_id = auth.uid()));
CREATE POLICY cm_delete ON public.comment_mentions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.comments c WHERE c.id = comment_id AND c.user_id = auth.uid()) OR public.is_manager_or_admin(auth.uid()));

-- Mention -> notification trigger
CREATE OR REPLACE FUNCTION public.on_comment_mention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.comments;
  t public.tasks;
  k text;
BEGIN
  SELECT * INTO c FROM public.comments WHERE id = NEW.comment_id;
  IF NOT FOUND OR c.user_id = NEW.mentioned_user_id THEN RETURN NEW; END IF;
  SELECT * INTO t FROM public.tasks WHERE id = c.work_item_id;
  k := 'MENTION_' || NEW.comment_id::text || '_' || NEW.mentioned_user_id::text;
  INSERT INTO public.notifications(user_id, type, title, body, task_id, dedupe_key)
  VALUES (NEW.mentioned_user_id, 'mention',
          COALESCE(t.task_code, 'Mention') || ' — you were mentioned',
          left(c.body, 240), c.work_item_id, k)
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.on_comment_mention() FROM PUBLIC;

CREATE TRIGGER trg_comment_mention
  AFTER INSERT ON public.comment_mentions
  FOR EACH ROW EXECUTE FUNCTION public.on_comment_mention();
