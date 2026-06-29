import {
  getOnboardingFn,
  setOnboardingStepFn,
  resetOnboardingFn,
} from "./onboarding.functions";

export type Onboarding = {
  id: number;
  current_step: number;
  industry: string | null;
  completed_at: string | null;
  data: Record<string, unknown>;
};

export const ONBOARDING_STEPS = [
  { id: 0, title: "Welcome", description: "Choose your industry" },
  { id: 1, title: "Install template pack", description: "One-click setup of types, workflows, fields, approvals" },
  { id: 2, title: "Configure ID prefixes", description: "Customize work-item codes (e.g. DV-2026-0001)" },
  { id: 3, title: "Add team members", description: "Invite users and assign roles" },
  { id: 4, title: "Smoke test", description: "Create your first work item and walk through approval" },
  { id: 5, title: "Done", description: "Your platform is pilot-ready" },
] as const;

export const onboardingService = {
  async get(): Promise<Onboarding> {
    const row = (await getOnboardingFn()) as Onboarding | null;
    return (
      row ?? {
        id: 1,
        current_step: 0,
        industry: null,
        completed_at: null,
        data: {},
      }
    );
  },

  async setStep(
    step: number,
    patch: Partial<Pick<Onboarding, "industry" | "data">> = {},
  ): Promise<void> {
    await setOnboardingStepFn({
      data: {
        step,
        completed: step >= ONBOARDING_STEPS.length - 1,
        industry: patch.industry ?? undefined,
        data: patch.data,
      },
    });
  },

  async reset(): Promise<void> {
    await resetOnboardingFn();
  },
};
