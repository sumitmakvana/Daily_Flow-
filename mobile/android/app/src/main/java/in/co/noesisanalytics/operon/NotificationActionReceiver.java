package in.co.noesisanalytics.operon;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Handles the "Start Task" notification button. The request goes to the Operon backend with a
 * short-lived, signed, user-and-task-bound action token delivered in the push payload; no login
 * credentials are stored or sent from here. The backend re-validates assignment and task status.
 */
public class NotificationActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context ctx, Intent intent) {
        if (!OperonNotifications.ACTION_START_TASK.equals(intent.getAction())) return;
        final int id = intent.getIntExtra(OperonNotifications.EXTRA_NOTIFICATION_ID, 0);
        final String token = intent.getStringExtra(OperonNotifications.EXTRA_ACTION_TOKEN);
        final String taskTitle = intent.getStringExtra(OperonNotifications.EXTRA_TASK_TITLE);
        if (token == null) return;

        // Immediately drop the button so a second tap cannot fire a duplicate request.
        OperonNotifications.showResult(ctx, id, "Starting task…", taskTitle == null ? "" : taskTitle, false);

        final PendingResult pending = goAsync();
        new Thread(() -> {
            String title;
            String body = taskTitle == null ? "" : taskTitle;
            boolean openApp = false;
            try {
                URL url = new URL(ctx.getString(R.string.operon_origin) + "/api/public/actions/push-start-task");
                HttpURLConnection c = (HttpURLConnection) url.openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setRequestMethod("POST");
                c.setRequestProperty("Content-Type", "application/json");
                c.setDoOutput(true);
                byte[] payload = new JSONObject().put("token", token).toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = c.getOutputStream()) {
                    os.write(payload);
                }
                int code = c.getResponseCode();
                InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
                String json = readAll(is);
                JSONObject res = new JSONObject(json);
                String result = res.optString("result", "");
                if ("started".equals(result)) {
                    title = "Task started";
                } else if ("already_in_progress".equals(result)) {
                    title = "Task already in progress";
                } else {
                    title = "Couldn't start task";
                    body = res.optString("message", "Open Operon to start it.");
                    openApp = true;
                }
            } catch (Exception e) {
                title = "Couldn't start task";
                body = "No connection. Open Operon to start it.";
                openApp = true;
            }
            OperonNotifications.showResult(ctx, id, title, body, openApp);
            pending.finish();
        }).start();
    }

    /** InputStream.readAllBytes() needs API 33; the app supports API 23+. */
    private static String readAll(InputStream is) throws java.io.IOException {
        if (is == null) return "{}";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[1024];
        int n;
        while ((n = is.read(buf)) != -1) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }
}
