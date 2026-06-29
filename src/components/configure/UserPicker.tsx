import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/types";

export function UserPicker({
  value,
  onChange,
  placeholder = "Select user…",
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  useEffect(() => {
    supabase.from("profiles").select("id,display_name,avatar_url").order("display_name").then(({ data }) => {
      setProfiles((data ?? []) as Profile[]);
    });
  }, []);
  return (
    <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
