-- Drop the old profiles update policy that was restricted to self-only
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;

-- Create a new policy that allows either the user themselves OR any Admin to update profiles
CREATE POLICY "profiles_update_self_or_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = id 
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    auth.uid() = id 
    OR public.has_role(auth.uid(), 'admin')
  );
