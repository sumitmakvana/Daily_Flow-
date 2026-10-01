-- Allow much longer comments (was capped at 4000 characters).
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_body_check;
ALTER TABLE public.comments
  ADD CONSTRAINT comments_body_check CHECK (length(body) BETWEEN 1 AND 50000);
