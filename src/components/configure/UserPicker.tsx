import { loadPeopleSafe } from "@/lib/people";
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
    loadPeopleSafe().then((rows) => {
      setProfiles(rows.sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? "")));
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
