
-- ============= ENUMS =============
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'member');
CREATE TYPE public.task_status AS ENUM ('To Do', 'In Progress', 'In Review', 'Blocked', 'On Hold', 'Completed');
CREATE TYPE public.task_priority AS ENUM ('High', 'Medium', 'Low');

-- ============= PROFILES =============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============= USER ROLES =============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer helper to avoid recursive RLS
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_manager_or_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin', 'manager')
  )
$$;

-- ============= TASKS =============
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_code TEXT NOT NULL UNIQUE, -- human-readable Task ID like T-001
  task_name TEXT NOT NULL,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  client TEXT,
  project_name TEXT,
  priority public.task_priority NOT NULL DEFAULT 'Medium',
  reviewer UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.task_status NOT NULL DEFAULT 'To Do',
  due_date DATE,
  done BOOLEAN NOT NULL DEFAULT false,
  remarks TEXT,
  planned_hours NUMERIC(6,2) DEFAULT 0,
  actual_hours NUMERIC(6,2) DEFAULT 0,
  blocker_reason TEXT,
  blocked_at TIMESTAMPTZ,
  sprint_week TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_tasks_assigned_to ON public.tasks(assigned_to);
CREATE INDEX idx_tasks_status ON public.tasks(status);
CREATE INDEX idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX idx_tasks_priority ON public.tasks(priority);

-- Auto-generate task code
CREATE SEQUENCE IF NOT EXISTS public.task_code_seq START 1;
CREATE OR REPLACE FUNCTION public.set_task_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.task_code IS NULL OR NEW.task_code = '' THEN
    NEW.task_code := 'T-' || LPAD(nextval('public.task_code_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_tasks_code BEFORE INSERT ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.set_task_code();

-- ============= TASK HISTORY =============
CREATE TABLE public.task_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  old_status public.task_status,
  new_status public.task_status,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.task_history ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_task_history_task_id ON public.task_history(task_id);

-- ============= NOTIFICATIONS =============
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_notifications_user ON public.notifications(user_id, read_at);

-- ============= TIMESTAMPS TRIGGER =============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= AUTO-CREATE PROFILE + ROLE ON SIGNUP =============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_first_user BOOLEAN;
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email
  );

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first_user;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN is_first_user THEN 'admin'::public.app_role ELSE 'member'::public.app_role END);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============= RLS POLICIES =============
-- profiles: everyone signed in can read, only self can update
CREATE POLICY "profiles_read_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- user_roles: signed-in users can read; only admin can write
CREATE POLICY "roles_read_all" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_admin_write" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- tasks: everyone reads; assignee/creator/manager can update; manager/admin can insert; manager/admin can delete
CREATE POLICY "tasks_read_all" ON public.tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE TO authenticated
  USING (
    assigned_to = auth.uid()
    OR created_by = auth.uid()
    OR public.is_manager_or_admin(auth.uid())
  );
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE TO authenticated
  USING (public.is_manager_or_admin(auth.uid()));

-- task_history: signed-in users read; anyone signed-in can insert their own history rows
CREATE POLICY "history_read_all" ON public.task_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "history_insert" ON public.task_history FOR INSERT TO authenticated
  WITH CHECK (updated_by = auth.uid());

-- notifications: only owner reads/updates
CREATE POLICY "notifications_read_own" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_update_own" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_insert_any" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);

-- Enable realtime for tasks + notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
