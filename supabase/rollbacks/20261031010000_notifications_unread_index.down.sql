CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, read_at);
DROP INDEX IF EXISTS public.idx_notifications_user_unread_created;
