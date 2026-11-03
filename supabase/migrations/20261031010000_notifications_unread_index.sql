-- Notifications: serve the unread badge count and "mark all read" from a small partial index.
--
-- The client's hot queries are all scoped to the last 24 h per user:
--   list / pages : WHERE user_id = $1 AND created_at >= $2 [AND created_at < $3] ORDER BY created_at DESC
--                  -> idx_notifications_user_created (user_id, created_at DESC), already present
--   unread count : WHERE user_id = $1 AND read_at IS NULL AND created_at >= $2
--   mark all read: same predicate, UPDATE
-- The unread queries only touch rows that are still unread, so index just those: the index stays tiny
-- (rows leave it as soon as they are read) and the count becomes an index-only scan.
--
-- Rollback: supabase/rollbacks/20261031010000_notifications_unread_index.down.sql

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- Superseded by the two indexes above for every current query shape (user_id, read_at) leading column
-- is covered by idx_notifications_user_created.
DROP INDEX IF EXISTS public.idx_notifications_user;
