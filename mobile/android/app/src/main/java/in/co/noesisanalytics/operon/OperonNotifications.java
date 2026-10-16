package in.co.noesisanalytics.operon;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.Map;

/** Builds Operon task notifications (shared by the FCM service and the action receiver). */
final class OperonNotifications {
    static final String EXTRA_NOTIFICATION_ID = "operon_notification_id";
    static final String EXTRA_ACTION_TOKEN = "operon_action_token";
    static final String EXTRA_TASK_TITLE = "operon_task_title";
    static final String ACTION_START_TASK = "in.co.noesisanalytics.operon.START_TASK";

    private OperonNotifications() {}

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        String id = ctx.getString(R.string.operon_channel_id);
        if (nm == null || nm.getNotificationChannel(id) != null) return;
        // No explicit sound: the channel uses the default Android notification sound.
        NotificationChannel ch = new NotificationChannel(
            id,
            ctx.getString(R.string.operon_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        ch.setDescription(ctx.getString(R.string.operon_channel_description));
        nm.createNotificationChannel(ch);
    }

    private static NotificationCompat.Builder base(Context ctx, String title, String body) {
        return new NotificationCompat.Builder(ctx, ctx.getString(R.string.operon_channel_id))
            .setSmallIcon(R.drawable.ic_stat_operon)
            .setColor(ctx.getColor(R.color.operon_notification_color))
            .setContentTitle(title)
            .setContentText(firstLine(body))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setDefaults(NotificationCompat.DEFAULT_SOUND)
            .setAutoCancel(true);
    }

    private static String firstLine(String s) {
        int i = s.indexOf('\n');
        return i < 0 ? s : s.substring(0, i);
    }

    /** Tap target: open the task inside the app via the existing https deep-link filter. */
    private static PendingIntent openIntent(Context ctx, int id, String path) {
        Uri uri = Uri.parse(ctx.getString(R.string.operon_origin) + (path == null ? "/notifications" : path));
        Intent i = new Intent(Intent.ACTION_VIEW, uri, ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void show(Context ctx, Map<String, String> data) {
        ensureChannel(ctx);
        String title = data.get("title") != null ? data.get("title") : "Operon";
        String body = data.get("body") != null ? data.get("body") : "";
        String taskId = data.get("task_id");
        // Stable id per notification so a retried delivery replaces rather than stacks.
        int id = (data.get("type") + ":" + taskId + ":" + data.get("notification_id")).hashCode();

        String url = data.get("url");
        String path = taskId != null
            ? "/tasks?taskId=" + Uri.encode(taskId) + "&tab=all_tasks"
            : (url != null && url.startsWith("/") ? url : null);
        NotificationCompat.Builder b = base(ctx, title, body).setContentIntent(openIntent(ctx, id, path));

        String token = data.get("action_token");
        if ("start".equals(data.get("action")) && token != null && !token.isEmpty()) {
            Intent a = new Intent(ctx, NotificationActionReceiver.class).setAction(ACTION_START_TASK);
            a.putExtra(EXTRA_NOTIFICATION_ID, id);
            a.putExtra(EXTRA_ACTION_TOKEN, token);
            a.putExtra(EXTRA_TASK_TITLE, firstLine(body));
            PendingIntent pi = PendingIntent.getBroadcast(
                ctx, id, a, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.addAction(0, ctx.getString(R.string.operon_action_start_task), pi);
        }
        notify(ctx, id, b);
    }

    /** Replace a notification with a plain status message (no buttons), e.g. after the action ran. */
    static void showResult(Context ctx, int id, String title, String body, boolean tapOpensApp) {
        NotificationCompat.Builder b = base(ctx, title, body)
            .setDefaults(0)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(15000);
        if (tapOpensApp) b.setContentIntent(openIntent(ctx, id, "/my-day"));
        notify(ctx, id, b);
    }

    private static void notify(Context ctx, int id, NotificationCompat.Builder b) {
        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted.
        }
    }
}
