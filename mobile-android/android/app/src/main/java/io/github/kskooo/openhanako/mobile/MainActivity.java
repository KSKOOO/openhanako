package io.github.kskooo.openhanako.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HanakoHttpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
