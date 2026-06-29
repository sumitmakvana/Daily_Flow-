
REVOKE EXECUTE ON FUNCTION public.detect_risks() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.compute_task_sla() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.bump_user_streak(uuid) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.on_task_completed_streak() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.on_eod_streak() FROM PUBLIC, authenticated, anon;
