-- One-off: fill the empty public.projects master list from project names already used on tasks.
-- Run as a DB owner (bypasses RLS). Safe to re-run: skips names that already exist (case-insensitive).
-- Names saved as "A | B" are split into separate projects, like the New Task form does.

INSERT INTO public.projects (name, client)
SELECT DISTINCT ON (lower(btrim(part)))
       btrim(part) AS name,
       NULLIF(btrim(t.client), '') AS client
  FROM public.tasks t
  CROSS JOIN LATERAL unnest(string_to_array(t.project_name, '|')) AS part
 WHERE btrim(part) <> ''
   AND NOT EXISTS (
         SELECT 1 FROM public.projects p WHERE lower(btrim(p.name)) = lower(btrim(part))
       )
 ORDER BY lower(btrim(part)), (NULLIF(btrim(t.client), '') IS NULL), t.created_at DESC;

-- Check:
-- SELECT count(*) FROM public.projects;
