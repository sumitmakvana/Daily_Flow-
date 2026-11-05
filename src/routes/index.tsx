import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getRolesShared } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/login" });
    const roles = await getRolesShared(data.session.user.id);
    const isManager = roles.some((r) => r === "manager" || r === "admin");
    throw redirect({ to: isManager ? "/executive" : "/my-day" });
  },
  component: () => null,
});
