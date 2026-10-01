import { createFileRoute } from "@tanstack/react-router";
import { NotebookView } from "@/components/notebook/NotebookView";

export const Route = createFileRoute("/_authenticated/notebook")({
  component: NotebookPage,
});

function NotebookPage() {
  return <NotebookView />;
}
