-- Signal row deletions on public.notifications so the server can push the corrected unread count over Socket.IO.
CREATE OR REPLACE FUNCTION public.notify_notification_deleted()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('notification_deleted', json_build_object('id', OLD.id, 'user_id', OLD.user_id)::text);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_deleted ON public.notifications;
CREATE TRIGGER trg_notification_deleted
AFTER DELETE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.notify_notification_deleted();
