-- E0.1D: scale-harden exec_summary at 100k tasks.
-- 1) Pin work_mem to 32MB for this function so the unfiltered rollup stops
--    spilling sort/hash state to temp files (measured at E0.1C: 60k temp
--    blocks read, 8.5k written at 100k tasks → 1.5–2.3s execution).
-- 2) Drop two write-only indexes that showed idx_scan=0 across the full
--    E0.1C seed-and-measure run (10k + 50k + 100k stages, all 7 filter
--    variants × 5 warm runs each).
ALTER FUNCTION public.exec_summary(integer, uuid, uuid, uuid, uuid)
  SET work_mem = '32MB';

DROP INDEX IF EXISTS public.idx_tasks_completed_at;
DROP INDEX IF EXISTS public.idx_adoption_daily_date_user;