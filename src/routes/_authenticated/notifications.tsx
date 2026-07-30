import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { NotificationsModalContent } from "@/components/NotificationsModal";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotifPage,
});

function NotifPage() {
  const navigate = useNavigate();
  return (
    <div className="py-6 px-3 md:px-6">
      <NotificationsModalContent isEmbedded onClose={() => navigate({ to: "/my-day" })} />
    </div>
  );
}
