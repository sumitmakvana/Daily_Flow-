-- Trigger to notify new_notification channel on insert to public.notifications
CREATE OR REPLACE FUNCTION public.notify_notification_inserted()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('new_notification', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_inserted ON public.notifications;
CREATE TRIGGER trg_notification_inserted
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.notify_notification_inserted();
