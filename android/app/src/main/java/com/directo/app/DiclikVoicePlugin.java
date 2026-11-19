package com.directo.app;

import android.media.AudioAttributes;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;
import java.util.UUID;

@CapacitorPlugin(name = "DiclikVoice")
public class DiclikVoicePlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private TextToSpeech engine;
    private PluginCall pending;
    private boolean ready;
    private boolean destroyed;

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty() || text.length() >= TextToSpeech.getMaxSpeechInputLength()) {
            call.reject("El texto de voz está vacío o es demasiado largo.");
            return;
        }
        main.post(() -> {
            if (destroyed) {
                call.reject("La voz ya no está disponible.");
                return;
            }
            if (ready) {
                play(call);
                return;
            }
            if (pending != null) pending.resolve();
            pending = call;
            if (engine == null) {
                engine = new TextToSpeech(getContext().getApplicationContext(),
                    status -> main.post(() -> initialize(status)));
            }
        });
    }

    private void initialize(int status) {
        if (destroyed) return;
        PluginCall call = pending;
        pending = null;
        ready = status == TextToSpeech.SUCCESS &&
            (engine.setLanguage(Locale.forLanguageTag("es-DO")) >= TextToSpeech.LANG_AVAILABLE ||
             engine.setLanguage(Locale.forLanguageTag("es-ES")) >= TextToSpeech.LANG_AVAILABLE);
        if (!ready) {
            engine.shutdown();
            engine = null;
            if (call != null) call.reject("Activa una voz en español en los ajustes de texto a voz de Android.");
            return;
        }
        engine.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build());
        if (call != null) play(call);
    }

    private void play(PluginCall call) {
        int result = engine.speak(call.getString("text"), TextToSpeech.QUEUE_FLUSH, null, UUID.randomUUID().toString());
        if (result == TextToSpeech.SUCCESS) call.resolve();
        else call.reject("Android no pudo reproducir la voz.");
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        if (pending != null) pending.reject("La voz ya no está disponible.");
        pending = null;
        if (engine != null) engine.shutdown();
        engine = null;
        ready = false;
    }
}
