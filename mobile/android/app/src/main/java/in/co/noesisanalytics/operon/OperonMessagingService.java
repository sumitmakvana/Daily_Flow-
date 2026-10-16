package in.co.noesisanalytics.operon;

import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Extends the Capacitor push service. Data messages flagged {@code operon_display=1} (task
 * notifications) are rendered natively so they can carry the Start Task action button; anything
 * else falls through to the stock Capacitor behaviour. Token refreshes still reach the JS layer.
 */
public class OperonMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if ("1".equals(data.get("operon_display"))) {
            OperonNotifications.show(getApplicationContext(), data);
            return;
        }
        super.onMessageReceived(message);
    }
}
