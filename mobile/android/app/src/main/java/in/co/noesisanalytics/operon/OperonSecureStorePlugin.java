package in.co.noesisanalytics.operon;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Secure storage for the app's long-lived refresh token. Values are encrypted with an AES-256-GCM
 * key that lives in the Android Keystore (never leaves secure hardware/OS storage, survives
 * reboots) and only the ciphertext is written to app-private SharedPreferences.
 */
@CapacitorPlugin(name = "OperonSecureStore")
public class OperonSecureStorePlugin extends Plugin {
    private static final String KEY_ALIAS = "operon_secure_store_key";
    private static final String PREFS = "operon_secure_store";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Only these keys may be used from JavaScript. */
    private static boolean allowed(String key) {
        return "kc_offline_session".equals(key);
    }

    private static SecretKey secretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            return (SecretKey) ks.getKey(KEY_ALIAS, null);
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        kg.init(
            new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
                )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return kg.generateKey();
    }

    private static String encrypt(String plain) throws Exception {
        Cipher c = Cipher.getInstance(TRANSFORMATION);
        c.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] out = new byte[iv.length + ct.length];
        System.arraycopy(iv, 0, out, 0, iv.length);
        System.arraycopy(ct, 0, out, iv.length, ct.length);
        return Base64.encodeToString(out, Base64.NO_WRAP);
    }

    private static String decrypt(String encoded) throws Exception {
        byte[] in = Base64.decode(encoded, Base64.NO_WRAP);
        final int ivLen = 12;
        Cipher c = Cipher.getInstance(TRANSFORMATION);
        c.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, in, 0, ivLen));
        return new String(c.doFinal(in, ivLen, in.length - ivLen), StandardCharsets.UTF_8);
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        JSObject ret = new JSObject();
        if (!allowed(key)) {
            call.reject("Unknown key");
            return;
        }
        String enc = prefs().getString(key, null);
        if (enc == null) {
            ret.put("value", JSObject.NULL);
            call.resolve(ret);
            return;
        }
        try {
            ret.put("value", decrypt(enc));
        } catch (Exception e) {
            // Key lost (backup restore, lock-screen reset, ...): the session is unrecoverable.
            prefs().edit().remove(key).commit();
            ret.put("value", JSObject.NULL);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (!allowed(key) || value == null) {
            call.reject("Invalid arguments");
            return;
        }
        try {
            if (!prefs().edit().putString(key, encrypt(value)).commit()) throw new Exception("write failed");
            call.resolve();
        } catch (Exception e) {
            call.reject("Secure storage unavailable");
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (!allowed(key)) {
            call.reject("Unknown key");
            return;
        }
        prefs().edit().remove(key).commit();
        call.resolve();
    }
}
