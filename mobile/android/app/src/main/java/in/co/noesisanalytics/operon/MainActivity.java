package in.co.noesisanalytics.operon;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Make sure the task channel (default sound, high importance) exists before any push arrives.
        OperonNotifications.ensureChannel(this);
        registerPlugin(OperonSecureStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
