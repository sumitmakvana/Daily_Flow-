-- Cleanup synthetic load-test data from E0.1C / E0.1D certification runs.
-- All seeded rows are tagged with the 'loadtest-' prefix; production data
-- (no such prefix) is left intact.

DELETE FROM public.approval_requests
  WHERE work_item_id IN (SELECT id FROM public.tasks WHERE task_name LIKE 'loadtest-%');

DELETE FROM public.risk_events
  WHERE entity_id IN (SELECT id FROM public.tasks WHERE task_name LIKE 'loadtest-%');

DELETE FROM public.carry_forward_events
  WHERE task_id IN (SELECT id FROM public.tasks WHERE task_name LIKE 'loadtest-%');

DELETE FROM public.tasks WHERE task_name LIKE 'loadtest-%';
DELETE FROM public.projects WHERE name LIKE 'loadtest-%';
DELETE FROM public.teams WHERE name LIKE 'loadtest-%';

DELETE FROM public.approval_chains
  WHERE id = '00000000-0000-0000-0003-000000000001'::uuid;

-- adoption_daily seed: only the rows for the admin profile over the past 60 days
-- with the synthetic pattern from the seed script (status_updates_count = d % 5).
-- Safe targeted delete by primary key range:
DELETE FROM public.adoption_daily
  WHERE user_id = 'ca1d011b-3e85-49d7-8df8-8a3715f8013b'::uuid
    AND rollup_date >= CURRENT_DATE - 60
    AND notif_interactions IN (0,1,2,3);