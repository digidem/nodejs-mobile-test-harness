package com.digidem.nodejstest;

import android.app.Activity;
import android.content.res.AssetManager;
import android.os.Bundle;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

public class TestActivity extends Activity {

    static {
        System.loadLibrary("node");
        System.loadLibrary("native-lib");
    }

    private static boolean _started = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (_started) return;
        _started = true;

        final String nodeDir =
            getApplicationContext().getFilesDir().getAbsolutePath() + "/nodejs-project";

        new Thread(new Runnable() {
            @Override
            public void run() {
                File nodeDirRef = new File(nodeDir);
                if (nodeDirRef.exists()) {
                    deleteRecursive(nodeDirRef);
                }
                copyAssetFolder(
                    getApplicationContext().getAssets(),
                    "nodejs-project",
                    nodeDir);

                int exitCode = startNodeWithArguments(new String[] {
                    "node",
                    nodeDir + "/main.js"
                });

                // Emit the exit sentinel so the CI runner can parse it from logcat.
                logExitSentinel(exitCode);

                // Terminate the process so `adb` / the runner sees the app exit.
                System.exit(exitCode);
            }
        }, "node-main").start();
    }

    public native int startNodeWithArguments(String[] arguments);

    public native void logExitSentinel(int code);

    private static boolean deleteRecursive(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursive(child);
        }
        return file.delete();
    }

    private static boolean copyAssetFolder(AssetManager am, String from, String to) {
        try {
            String[] files = am.list(from);
            if (files == null || files.length == 0) {
                return copyAsset(am, from, to);
            }
            new File(to).mkdirs();
            boolean ok = true;
            for (String f : files) {
                ok &= copyAssetFolder(am, from + "/" + f, to + "/" + f);
            }
            return ok;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    private static boolean copyAsset(AssetManager am, String from, String to) {
        try (InputStream in = am.open(from);
             OutputStream out = new FileOutputStream(to)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return true;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }
}
