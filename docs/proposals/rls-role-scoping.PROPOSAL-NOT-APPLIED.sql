  -- ============================================================================================
  -- PROPOSAL ONLY - NOT APPLIED, NOT A MIGRATION. Needs review and approval before anything runs.
  -- Verified against the LOCAL test database only (pg_policies); production was not touched.
  --
  -- Goal: the database, not just the UI/query layer, enforces
  --   Admin / Manager  -> every task (unchanged)
  --   Member           -> tasks assigned to them
  --   Reviewer         -> additionally the tasks they review (tasks.reviewer OR a task_reviewers row)
  --   Creator          -> additionally the tasks they created (so "assign to someone else" still shows the task)
  --
  -- Today: tasks_read_all, "Authenticated users can select worklogs", comments_read, attach_read,
  -- history_read_all, cfe_read_all, risk_read_all, task_reviewers_read are all USING (true), so any signed-in
  -- user can read every task and its worklogs/comments/history through the API (PostgREST) directly.
  --
  -- BEFORE APPLYING (pages that read other people's tasks as a member would change behaviour):
  --   * Team Tasks/All Tasks tabs are already hidden for members; Calendar, Global Search and Tasks are already
  --     query-scoped to assigned_to for members, so the UI result is unchanged.
  --   * Check any member-facing feature that shows a colleague's task (mentions, relations/dependencies,
  --     approvals, leave-cover). Those would need the extra predicates below or a SECURITY DEFINER function.
  --   * Add indexes first (CREATE INDEX CONCURRENTLY, outside this transaction): tasks(created_by),
  --     task_reviewers(reviewer_id, task_id). tasks(assigned_to) and tasks(reviewer) are already indexed.
  --   * Test with a real member, reviewer, manager and admin account on a copy of the data.
  -- ============================================================================================

  BEGIN;

  -- Helper (cheap, STABLE): may the current user see this task?
  CREATE OR REPLACE FUNCTION public.can_see_task(_task_id uuid)
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = _task_id
        AND (   t.assigned_to = auth.uid()
            OR t.created_by  = auth.uid()
            OR t.reviewer    = auth.uid()
            OR EXISTS (SELECT 1 FROM public.task_reviewers r WHERE r.task_id = t.id AND r.reviewer_id = auth.uid())
            OR public.is_manager_or_admin(auth.uid()))
    );
  $$;

  -- tasks
  DROP POLICY IF EXISTS tasks_read_all ON public.tasks;
  CREATE POLICY tasks_read_scoped ON public.tasks FOR SELECT TO authenticated USING (
      assigned_to = auth.uid()
    OR created_by  = auth.uid()
    OR reviewer    = auth.uid()
    OR EXISTS (SELECT 1 FROM public.task_reviewers r WHERE r.task_id = tasks.id AND r.reviewer_id = auth.uid())
    OR public.is_manager_or_admin(auth.uid())
  );

  -- worklogs: own rows, rows on tasks the user may see, managers/admins everything
  DROP POLICY IF EXISTS "Authenticated users can select worklogs" ON public.task_worklogs;
  CREATE POLICY worklogs_read_scoped ON public.task_worklogs FOR SELECT TO authenticated USING (
      user_id = auth.uid()
    OR public.is_manager_or_admin(auth.uid())
    OR public.can_see_task(task_id)
  );

  -- task-attached data follows task visibility
  DROP POLICY IF EXISTS comments_read ON public.comments;
  CREATE POLICY comments_read_scoped ON public.comments FOR SELECT TO authenticated
    USING (public.is_manager_or_admin(auth.uid()) OR public.can_see_task(work_item_id));

  DROP POLICY IF EXISTS attach_read ON public.attachments;
  CREATE POLICY attach_read_scoped ON public.attachments FOR SELECT TO authenticated
    USING (public.is_manager_or_admin(auth.uid()) OR public.can_see_task(work_item_id));

  DROP POLICY IF EXISTS history_read_all ON public.task_history;
  CREATE POLICY history_read_scoped ON public.task_history FOR SELECT TO authenticated
    USING (public.is_manager_or_admin(auth.uid()) OR public.can_see_task(task_id));

  DROP POLICY IF EXISTS cfe_read_all ON public.carry_forward_events;
  CREATE POLICY cfe_read_scoped ON public.carry_forward_events FOR SELECT TO authenticated
    USING (public.is_manager_or_admin(auth.uid()) OR public.can_see_task(task_id));

  DROP POLICY IF EXISTS task_reviewers_read ON public.task_reviewers;
  CREATE POLICY task_reviewers_read_scoped ON public.task_reviewers FOR SELECT TO authenticated
    USING (reviewer_id = auth.uid() OR public.is_manager_or_admin(auth.uid()) OR public.can_see_task(task_id));

  -- risks on tasks: only the ones for tasks the user can see (entity_type = 'task')
  DROP POLICY IF EXISTS risk_read_all ON public.risk_events;
  CREATE POLICY risk_read_scoped ON public.risk_events FOR SELECT TO authenticated USING (
      public.is_manager_or_admin(auth.uid())
    OR (entity_type = 'task' AND public.can_see_task(entity_id::uuid))
  );

  -- NOT changed here, but worth a decision (found in the audit):
  --   * tasks_update / tasks_delete let the creator OR assignee change/delete ANY column of the task
  --     (a member can reassign, re-prioritise, change reviewer, or delete). Consider a column-guard trigger.
  --   * a reviewer who is neither assignee nor creator cannot UPDATE the task row under tasks_update, so any
  --     reviewer approve/reject path must go through a server function (service role) - confirm that it does.
  --   * work_settings / profiles are readable by everyone (profiles are needed for names; fine).
  --   * approval_requests ar_read is already scoped (requester, admin, approver).

  COMMIT;
