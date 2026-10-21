package in.co.noesisanalytics.operon;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.security.InvalidKeyException;
import java.security.KeyStore;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Stores small secrets (the Keycloak offline refresh token) encrypted with a non-exportable
 * AES-256-GCM key held in the Android Keystore. Ciphertext lives in private SharedPreferences,
 * which are excluded from backups (allowBackup=false).
 *
 * Calls are only honoured while the WebView is showing the configured Operon https origin, so other
 * pages (e.g. a sibling *.noesisanalytics.co.in host reachable via allowNavigation) cannot read it.
 */
@CapacitorPlugin(name = "OperonSecureStorage")
public class OperonSecureStoragePlugin extends Plugin {
    private static final String KEY_ALIAS = "operon_secure_storage_key";
    private static final String PREFS = "operon_secure_storage";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LEN = 12;
    private static final int MAX_VALUE_LEN = 8192;

    private SecretKey key(boolean createIfMissing) throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return (SecretKey) ks.getKey(KEY_ALIAS, null);
        }
        if (!createIfMissing) {
            throw new InvalidKeyException("key missing");
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        kg.init(
            new KeyGenParameterSpec.Builder(
                    KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return kg.generateKey();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static boolean validKey(String k) {
        return k != null && k.matches("^[a-z_]{1,40}$");
    }

    /** True only if the WebView's current page is on the configured Operon https origin. */
    private boolean trustedOrigin() {
        try {
            String configured = getBridge().getConfig().getServerUrl();
            if (configured == null) return false;
            Uri expected = Uri.parse(configured);
            final String[] current = new String[1];
            if (Looper.myLooper() == Looper.getMainLooper()) {
                current[0] = getBridge().getWebView().getUrl();
            } else {
                final CountDownLatch latch = new CountDownLatch(1);
                getActivity()
                    .runOnUiThread(
                        () -> {
                            try {
                                current[0] = getBridge().getWebView().getUrl();
                            } finally {
                                latch.countDown();
                            }
                        });
                if (!latch.await(2, TimeUnit.SECONDS)) return false;
            }
            if (current[0] == null) return false;
            Uri actual = Uri.parse(current[0]);
            return "https".equals(expected.getScheme())
                && "https".equals(actual.getScheme())
                && expected.getHost() != null
                && expected.getHost().equalsIgnoreCase(actual.getHost())
                && expected.getPort() == actual.getPort();
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String k = call.getString("key");
        String v = call.getString("value");
        if (!trustedOrigin()) {
            call.reject("untrusted origin");
            return;
        }
        if (!validKey(k) || v == null || v.isEmpty() || v.length() > MAX_VALUE_LEN) {
            call.reject("invalid arguments");
            return;
        }
        try {
            Cipher c = Cipher.getInstance(TRANSFORMATION);
            c.init(Cipher.ENCRYPT_MODE, key(true));
            byte[] iv = c.getIV();
            byte[] ct = c.doFinal(v.getBytes("UTF-8"));
            ByteBuffer buf = ByteBuffer.allocate(iv.length + ct.length);
            buf.put(iv).put(ct);
            prefs().edit().putString(k, Base64.encodeToString(buf.array(), Base64.NO_WRAP)).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("secure write failed");
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String k = call.getString("key");
        if (!trustedOrigin()) {
            call.reject("untrusted origin");
            return;
        }
        if (!validKey(k)) {
            call.reject("invalid arguments");
            return;
        }
        JSObject ret = new JSObject();
        String stored = prefs().getString(k, null);
        if (stored == null) {
            ret.put("value", JSObject.NULL);
            call.resolve(ret);
            return;
        }
        try {
            byte[] all = Base64.decode(stored, Base64.NO_WRAP);
            if (all.length <= IV_LEN) throw new AEADBadTagException("truncated");
            Cipher c = Cipher.getInstance(TRANSFORMATION);
            c.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, all, 0, IV_LEN));
            byte[] pt = c.doFinal(all, IV_LEN, all.length - IV_LEN);
            ret.put("value", new String(pt, "UTF-8"));
            call.resolve(ret);
        } catch (AEADBadTagException | InvalidKeyException | IllegalArgumentException e) {
            // Permanent: key gone/invalidated or ciphertext corrupt. Drop it; the user logs in again.
            prefs().edit().remove(k).apply();
            ret.put("value", JSObject.NULL);
            call.resolve(ret);
        } catch (Exception e) {
            // Possibly transient (Keystore unavailable, e.g. some OEMs before first unlock):
            // keep the stored value and report an error so the caller retries later.
            call.reject("secure read failed");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String k = call.getString("key");
        if (!trustedOrigin()) {
            call.reject("untrusted origin");
            return;
        }
        if (!validKey(k)) {
            call.reject("invalid arguments");
            return;
        }
        prefs().edit().remove(k).apply();
        call.resolve();
    }
}
