package io.github.kskooo.openhanako.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

@CapacitorPlugin(name = "HanakoHttp")
public class HanakoHttpPlugin extends Plugin {
    @PluginMethod
    public void request(PluginCall call) {
        new Thread(() -> runRequest(call)).start();
    }

    private void runRequest(PluginCall call) {
        int statusCode = 0;
        boolean ok = false;
        String data = "";
        String message = "";
        HttpURLConnection connection = null;
        try {
            String urlText = call.getString("url", "");
            String method = call.getString("method", "GET");
            int timeout = call.getInt("timeout", 60000);
            JSObject headers = call.getObject("headers", new JSObject());
            Object body = call.getData().opt("data");
            if (urlText == null || urlText.trim().isEmpty()) throw new IllegalArgumentException("url is required");

            connection = (HttpURLConnection) new URL(urlText).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(timeout);
            connection.setReadTimeout(timeout);
            connection.setUseCaches(false);
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                connection.setRequestProperty(key, headers.optString(key, ""));
            }
            if (body != null && !JSONObject.NULL.equals(body) && !"GET".equalsIgnoreCase(method)) {
                connection.setDoOutput(true);
                String payload = body instanceof String ? (String) body : body.toString();
                byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
                connection.setRequestProperty("Content-Length", String.valueOf(bytes.length));
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
            }

            statusCode = connection.getResponseCode();
            ok = statusCode >= 200 && statusCode < 300;
            InputStream input = ok ? connection.getInputStream() : connection.getErrorStream();
            data = readAll(input);
        } catch (Exception error) {
            message = error.getMessage() == null ? error.toString() : error.getMessage();
        } finally {
            if (connection != null) connection.disconnect();
        }

        JSObject response = new JSObject();
        response.put("ok", ok);
        response.put("statusCode", statusCode);
        response.put("data", data);
        response.put("message", message);
        call.resolve(response);
    }

    private String readAll(InputStream input) throws Exception {
        if (input == null) return "";
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) builder.append(line);
        }
        return builder.toString();
    }
}

