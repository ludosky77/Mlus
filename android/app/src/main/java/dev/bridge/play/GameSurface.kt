package dev.bridge.play

import android.content.Context
import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Handler
import android.os.HandlerThread
import android.view.Gravity
import android.view.MotionEvent
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.util.ArrayDeque

@Composable
fun GameSurface(model: BridgeModel, width: Int, height: Int, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val view = remember(width, height) { AndroidGameView(context, model, width, height) }
    DisposableEffect(view) { onDispose { view.dispose() } }
    AndroidView(factory = { view }, modifier = modifier)
}

/** Native decoded video and normalized multi-touch. No game-specific names or web UI. */
private class AndroidGameView(context: Context, private val model: BridgeModel, private val videoWidth: Int, private val videoHeight: Int) : FrameLayout(context), SurfaceHolder.Callback {
    private val screen = SurfaceView(context)
    private var decoder: H264Decoder? = null
    private val fingers = mutableMapOf<Int, Int>()
    private var contacts = JSONArray()
    private val heartbeat = object : Runnable {
        override fun run() {
            if (contacts.length() > 0 && isShown && hasWindowFocus()) model.touches(contacts)
            postDelayed(this, 250)
        }
    }
    init {
        setBackgroundColor(android.graphics.Color.BLACK)
        isClickable = true; contentDescription = "Shared Android application"
        addView(screen, LayoutParams(1, 1, Gravity.CENTER))
        screen.holder.addCallback(this)
        post(heartbeat)
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        val scale = minOf(w.toFloat() / videoWidth, h.toFloat() / videoHeight)
        screen.layoutParams = LayoutParams((videoWidth * scale).toInt().coerceAtLeast(1), (videoHeight * scale).toInt().coerceAtLeast(1), Gravity.CENTER)
    }
    override fun surfaceCreated(holder: SurfaceHolder) {
        decoder = H264Decoder(holder.surface, videoWidth, videoHeight, model::videoError)
        model.attachVideo { bytes -> decoder?.offer(bytes) }
    }
    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit
    override fun surfaceDestroyed(holder: SurfaceHolder) { clearTouches(); model.detachVideo(); decoder?.close(); decoder = null }
    override fun onInterceptTouchEvent(event: MotionEvent) = true
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_CANCEL) { clearTouches(); return true }
        if (screen.width <= 0 || screen.height <= 0) return false
        val lift = if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_POINTER_UP) event.getPointerId(event.actionIndex) else -1
        val active = mutableSetOf<Int>(); val next = JSONArray()
        for (index in 0 until event.pointerCount) {
            val id = event.getPointerId(index)
            if (id == lift) continue
            val x = (event.getX(index) - screen.left) / screen.width
            val y = (event.getY(index) - screen.top) / screen.height
            if (id !in fingers && (x !in 0f..1f || y !in 0f..1f)) continue
            val slot = fingers[id] ?: (0..4).firstOrNull { it !in fingers.values } ?: continue
            fingers[id] = slot; active.add(id)
            next.put(JSONObject().put("id", slot).put("x", x.coerceIn(0f, 1f).toDouble()).put("y", y.coerceIn(0f, 1f).toDouble()))
        }
        fingers.keys.retainAll(active); contacts = next; model.touches(next)
        if (event.actionMasked == MotionEvent.ACTION_UP) performClick()
        return true
    }
    override fun performClick(): Boolean { super.performClick(); return true }
    override fun onWindowFocusChanged(hasWindowFocus: Boolean) { super.onWindowFocusChanged(hasWindowFocus); if (!hasWindowFocus) clearTouches() }
    override fun onWindowVisibilityChanged(visibility: Int) { super.onWindowVisibilityChanged(visibility); if (visibility != View.VISIBLE) clearTouches() }
    private fun clearTouches() { fingers.clear(); contacts = JSONArray(); model.releaseControls() }
    fun dispose() { removeCallbacks(heartbeat); clearTouches(); model.detachVideo(); decoder?.close(); decoder = null; screen.holder.removeCallback(this) }
}

private class H264Decoder(surface: Surface, width: Int, height: Int, private val onError: (String) -> Unit) {
    private val thread = HandlerThread("bridge-video").apply { start() }
    private val handler = Handler(thread.looper)
    private val packets = ArrayDeque<ByteArray>()
    private val inputs = ArrayDeque<Int>()
    private var bytesQueued = 0
    private var waitingKey = true
    private var configuration: ByteArray? = null
    @Volatile private var closed = false
    private var codec: MediaCodec? = null
    init {
        handler.post {
            try {
                val decoder = MediaCodec.createDecoderByType("video/avc"); codec = decoder
                decoder.setCallback(object : MediaCodec.Callback() {
                    override fun onInputBufferAvailable(codec: MediaCodec, index: Int) { inputs.add(index); drain() }
                    override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
                        if (!closed) try { codec.releaseOutputBuffer(index, true) } catch (_: Exception) { failed() }
                    }
                    override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) = Unit
                    override fun onError(codec: MediaCodec, error: MediaCodec.CodecException) { failed() }
                }, handler)
                val format = MediaFormat.createVideoFormat("video/avc", width, height).apply { setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, MAX_FRAME_BYTES) }
                decoder.configure(format, surface, null, 0)
                decoder.setVideoScalingMode(MediaCodec.VIDEO_SCALING_MODE_SCALE_TO_FIT)
                decoder.start()
            } catch (_: Exception) { failed() }
        }
    }
    fun offer(packet: ByteArray) {
        if (closed || packet.size <= 9 || packet.size > MAX_FRAME_BYTES + 9) return
        // Bound queued payload before scheduling more decoder work on its thread.
        synchronized(packets) {
            val config = packet[0].toInt() and 1 != 0
            val key = packet[0].toInt() and 2 != 0
            if (config && packet.size > 256 * 1024) return
            if (config) configuration = packet
            if (packets.size >= 16 || bytesQueued + packet.size > MAX_FRAME_BYTES + 9) { packets.clear(); bytesQueued = 0; waitingKey = true }
            if (!config && waitingKey && !key) return
            if (key && waitingKey) { configuration?.let { packets.add(it); bytesQueued += it.size }; waitingKey = false }
            packets.add(packet); bytesQueued += packet.size
        }
        handler.post { drain() }
    }
    private fun drain() {
        if (closed) return
        val decoder = codec ?: return
        try {
            while (inputs.isNotEmpty()) {
                val packet = synchronized(packets) { if (packets.isEmpty()) null else packets.removeFirst().also { bytesQueued -= it.size } } ?: break
                val index = inputs.removeFirst()
                val buffer = decoder.getInputBuffer(index) ?: error("Missing video buffer")
                buffer.clear()
                if (packet.size - 9 > buffer.remaining()) error("Video packet too large")
                buffer.put(packet, 9, packet.size - 9)
                val timestamp = ByteBuffer.wrap(packet, 1, 8).long
                val flags = if (packet[0].toInt() and 1 != 0) MediaCodec.BUFFER_FLAG_CODEC_CONFIG else 0
                decoder.queueInputBuffer(index, 0, packet.size - 9, timestamp, flags)
            }
        } catch (_: Exception) { failed() }
    }
    private fun failed() { if (!closed) onError("The Android video decoder could not continue. Rejoin the room to reconnect."); close() }
    fun close() {
        if (closed) return
        closed = true
        handler.post {
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            codec = null; inputs.clear()
            synchronized(packets) { packets.clear(); bytesQueued = 0 }
            thread.quitSafely()
        }
    }
    companion object { const val MAX_FRAME_BYTES = 8 * 1024 * 1024 }
}
