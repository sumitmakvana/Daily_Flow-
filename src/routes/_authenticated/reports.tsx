import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/reports")({
  beforeLoad: () => {
    throw redirect({ to: "/exports" });
  },
  component: () => null,
});

