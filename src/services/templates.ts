import {
  listTemplatesFn,
  listTemplateComponentsFn,
  installTemplateFn,
} from "./templates.functions";

export type IndustryTemplate = {
  id: string;
  key: string;
  name: string;
  industry: "it" | "pharma" | "adhesives" | "manufacturing" | "consulting" | "generic";
  version: number;
  description: string | null;
  is_installed: boolean;
  installed_at: string | null;
  installed_by: string | null;
};

export type TemplateComponent = {
  id: string;
  template_id: string;
  component_kind:
    | "work_item_type" | "status" | "transition"
    | "field_def" | "approval_chain" | "approval_step";
  payload: Record<string, unknown>;
  apply_order: number;
};

export const templatesService = {
  async list(): Promise<IndustryTemplate[]> {
    return (await listTemplatesFn()) as IndustryTemplate[];
  },

  async componentsFor(templateId: string): Promise<TemplateComponent[]> {
    return (await listTemplateComponentsFn({
      data: { templateId },
    })) as TemplateComponent[];
  },

  async install(templateId: string): Promise<void> {
    await installTemplateFn({ data: { templateId } });
  },
};
