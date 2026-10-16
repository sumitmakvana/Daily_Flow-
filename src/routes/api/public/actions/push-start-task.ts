import { createFileRoute } from "@tanstack/react-router";
import {
  markActionRedeemed,
  releaseAction,
  verifyPushAction,
} from "@/lib/push-action-token.server";
import { startTaskForUser, type StartTaskResult } from "@/lib/task-start.server";
import { pushTaskProgress } from "@/lib/task-push.server";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const STATUS: Record<StartTaskResult, number> = {
  started: 200,
  already_in_progress: 200,
  completed: 409,
  not_eligible: 409,
  forbidden: 403,
  not_found: 404,
};

/**
 * "Start Task" button on the Android task-assignment notification.
 * Auth: a signed, expiring, one-time action token minted for (user, task) when the push was sent.
 * The task assignment and status are re-validated here; nothing from the request body other than
 * the token is trusted.
 */
export const Route = createFileRoute("/api/public/actions/push-start-task")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let token: unknown;
        try {
          if (Number(request.headers.get("content-length") ?? 0) > 4096) {
            return json(413, { result: "invalid", message: "Request too large." });
          }
          token = ((await request.json()) as { token?: unknown })?.token;
        } catch {
          return json(400, { result: "invalid", message: "Invalid request." });
        }

        const claims = verifyPushAction(token);
        if (!claims) {
          return json(401, {
            result: "invalid",
            message: "This action has expired. Open Operon to start the task.",
          });
        }
        if (!markActionRedeemed(claims)) {
          return json(409, { result: "already_used", message: "This button was already used." });
        }

        try {
          const outcome = await startTaskForUser(claims.u, claims.t);
          if (outcome.result === "started") {
            void pushTaskProgress("started", claims.t, claims.u);
          }
          return json(STATUS[outcome.result], { result: outcome.result, message: outcome.message });
        } catch (err) {
          // Transient failure: let the user retry with the same notification.
          releaseAction(claims);
          console.error("[push-start-task] failed:", (err as Error).message);
          return json(500, {
            result: "error",
            message: "Something went wrong. Open Operon to start the task.",
          });
        }
      },
    },
  },
});
