import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { orgRolesService, type OrgRole } from "@/services/org-roles";

/** Dropdown of tenant roles by key. Used by approvals and workflow transitions. */
export function RoleSelect({
  value, onChange, placeholder = "Pick a role…", includeInactive = false,
}: {
  value: string | null;
  onChange: (key: string) => void;
  placeholder?: string;
  includeInactive?: boolean;
}) {
  const [roles, setRoles] = useState<OrgRole[]>([]);
  useEffect(() => {
    orgRolesService.list(includeInactive).then(setRoles).catch(() => setRoles([]));
  }, [includeInactive]);
  return (
    <Select value={value ?? ""} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {roles.map((r) => (
          <SelectItem key={r.key} value={r.key}>
            {r.label}{r.is_system ? " (system)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
