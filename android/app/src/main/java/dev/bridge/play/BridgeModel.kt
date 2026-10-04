package dev.bridge.play

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class Player(val id: String, val name: String, val role: String)
data class RuntimeState(val state: String, val message: String, val width: Int = 0, val height: Int = 0, val streamId: String = "")
data class Room(val code: String, val title: String, val kind: String, val status: String, val players: List<Player>, val runtime: RuntimeState?)
data class ChatMessage(val id: String, val name: String, val text: String, val mine: Boolean)
data class BridgeState(
    val games: List<LocalGame> = emptyList(), val online: Boolean = false,
    val connecting: Boolean = true, val busy: Boolean = false,
    val importing: Boolean = false, val importBytes: Long = 0,
    val runtimeAvailable: Boolean = false,
    val server: String = "http://127.0.0.1:3210", val name: String = "",
    val room: Room? = null, val role: String = "", val chat: List<ChatMessage> = emptyList(),
    val gameplayConnected: Boolean = false, val gameplayError: String? = null,
    val ping: Int? = null, val error: String? = null,
)

class BridgeModel(application: Application) : AndroidViewModel(application) {
    private val prefs = application.getSharedPreferences("bridge", 0)
    private val library = ApkLibrary(application)
    private val client = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
    private val uploader = client.newBuilder().writeTimeout(5, TimeUnit.MINUTES).readTimeout(30, TimeUnit.SECONDS).build()
    private val mutable = MutableStateFlow(BridgeState(server = prefs.getString("server", "http://127.0.0.1:3210")!!, name = prefs.getString("name", "")!!))
    val state = mutable.asStateFlow()
    private var socket: WebSocket? = null
    private var selfId = ""
    private var selectedGame: LocalGame? = null
    @Volatile private var generation = 0
    private var shuttingDown = false
    private var upload: Call? = null
    @Volatile private var videoSink: ((ByteArray) -> Unit)? = null

    init {
        viewModelScope.launch { val games = withContext(Dispatchers.IO) { library.load() }; update { it.copy(games = games) } }
        connect()
        viewModelScope.launch { while (true) { delay(5000); if (mutable.value.room != null) send(JSONObject().put("type", "ping").put("sentAt", System.currentTimeMillis())) } }
    }
    private fun update(block: (BridgeState) -> BridgeState) { mutable.value = block(mutable.value) }
    fun clearError() = update { it.copy(error = null) }
    private fun fail(message: String) = update { it.copy(error = message, busy = false) }
    fun saveName(name: String) { val safe = name.trim().take(24); prefs.edit().putString("name", safe).apply(); update { it.copy(name = safe) } }
    fun saveServer(value: String) {
        val parsed = value.trim().toHttpUrlOrNull()
        if (parsed == null || parsed.username.isNotEmpty() || parsed.password.isNotEmpty() || parsed.query != null || parsed.fragment != null) { fail("Enter an HTTP or HTTPS server address."); return }
        val base = parsed.newBuilder().encodedPath("/").build().toString().trimEnd('/')
        leaveRoom(); prefs.edit().putString("server", base).apply(); update { it.copy(server = base) }; connect()
    }
    private fun connect() {
        val run = ++generation
        socket?.cancel(); socket = null
        update { it.copy(online = false, connecting = true, busy = false, runtimeAvailable = false) }
        viewModelScope.launch {
            val base = mutable.value.server
            val available = withContext(Dispatchers.IO) {
                try { client.newCall(Request.Builder().url("$base/config").build()).execute().use { response ->
                    val android = JSONObject(response.body?.string() ?: "{}").optJSONObject("android")
                    android?.optBoolean("enabled") == true && android.optInt("available") > 0
                } } catch (_: Exception) { false }
            }
            if (run != generation || shuttingDown) return@launch
            update { it.copy(runtimeAvailable = available) }
            val url = base.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://") + "/socket"
            socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) { onMain(run) { update { it.copy(online = true, connecting = false) } } }
                override fun onMessage(webSocket: WebSocket, text: String) { onMain(run) { try { receive(JSONObject(text)) } catch (_: Exception) { fail("The room server sent an invalid response.") } } }
                override fun onMessage(webSocket: WebSocket, bytes: ByteString) { if (run == generation) videoSink?.invoke(bytes.toByteArray()) }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { disconnected(run) }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { disconnected(run) }
            })
        }
    }
    private fun onMain(run: Int, action: () -> Unit) { viewModelScope.launch { if (run == generation && !shuttingDown) action() } }
    private fun disconnected(run: Int) { onMain(run) {
        val hadRoom = mutable.value.room != null; resetRoom()
        update { it.copy(online = false, connecting = false, error = if (hadRoom) "Connection lost. Rejoin when the server reconnects." else it.error) }
        viewModelScope.launch { delay(3500); if (run == generation && !shuttingDown) connect() }
    } }
    private fun send(packet: JSONObject): Boolean {
        if (!mutable.value.online) { fail("Connect to the room server in Settings first."); return false }
        val queued = socket?.send(packet.toString()) == true
        if (!queued) fail("The server connection was lost. Wait for it to reconnect.")
        return queued
    }
    fun createRoom(game: LocalGame) {
        if (mutable.value.name.isBlank()) { fail("Enter your player name first."); return }
        selectedGame = game; update { it.copy(busy = true) }
        send(JSONObject().put("type", "create").put("name", mutable.value.name).put("game", JSONObject().put("title", game.title).put("kind", "apk").put("sha256", game.id)))
    }
    fun joinRoom(code: String) {
        if (mutable.value.name.isBlank()) { fail("Enter your player name first."); return }
        update { it.copy(busy = true) }
        send(JSONObject().put("type", "join").put("name", mutable.value.name).put("code", code.trim().uppercase()))
    }
    fun leaveRoom() { if (mutable.value.room != null && mutable.value.online) send(JSONObject().put("type", "leave")); resetRoom() }
    private fun resetRoom() {
        upload?.cancel(); upload = null; videoSink = null
        update { it.copy(room = null, role = "", chat = emptyList(), gameplayConnected = false, gameplayError = null, ping = null, busy = false) }
    }
    private fun room(json: JSONObject): Room {
        val players = json.getJSONArray("players")
        val runtime = json.optJSONObject("runtime")?.let { RuntimeState(it.getString("state"), it.optString("message"), it.optInt("width"), it.optInt("height"), it.optString("streamId")) }
        return Room(json.getString("code"), json.getJSONObject("game").getString("title"), json.getJSONObject("game").getString("kind"), json.getString("status"),
            (0 until players.length()).map { val p = players.getJSONObject(it); Player(p.getString("id"), p.getString("name"), p.getString("role")) }, runtime)
    }
    private fun receive(packet: JSONObject) {
        when (packet.getString("type")) {
            "hello" -> selfId = packet.getString("id")
            "error" -> fail(packet.getString("message"))
            "joined" -> {
                val joined = room(packet.getJSONObject("room"))
                if (joined.kind != "apk") { send(JSONObject().put("type", "leave")); fail("This is an old experimental room. Create an Android APK room instead."); return }
                update { it.copy(room = joined, role = packet.getString("role"), busy = false, chat = emptyList()) }
                if (mutable.value.role == "host") uploadApk(joined.code, packet.getString("uploadToken"))
            }
            "room" -> if (mutable.value.room != null) {
                val updated = room(packet.getJSONObject("room"))
                update { it.copy(room = updated, gameplayConnected = updated.runtime?.state == "streaming", gameplayError = updated.runtime?.takeIf { r -> r.state == "failed" }?.message) }
            }
            "peer-left" -> releaseControls()
            "closed" -> { resetRoom(); fail(packet.getString("message")) }
            "left" -> resetRoom()
            "chat" -> { val who = packet.getJSONObject("sender"); val message = ChatMessage(packet.getString("id"), who.getString("name"), packet.getString("text"), who.getString("id") == selfId); update { it.copy(chat = (it.chat + message).takeLast(100)) } }
            "pong" -> update { it.copy(ping = (System.currentTimeMillis() - packet.optLong("sentAt", System.currentTimeMillis())).coerceIn(0, 100_000).toInt()) }
        }
    }
    private fun uploadApk(code: String, token: String) {
        val game = selectedGame ?: return
        val request = Request.Builder().url("${mutable.value.server}/api/rooms/$code/apk").header("Authorization", "Bearer $token")
            .post(library.file(game).asRequestBody("application/vnd.android.package-archive".toMediaType())).build()
        upload = uploader.newCall(request)
        val call = upload!!
        viewModelScope.launch {
            val problem = withContext(Dispatchers.IO) {
                try { call.execute().use { if (it.code == 202) null else it.body?.string()?.take(240) ?: "APK upload failed." } }
                catch (_: Exception) { "APK upload was interrupted. Create a new room to retry." }
            }
            if (mutable.value.room?.code == code && problem != null) update { it.copy(gameplayError = problem) }
        }
    }
    fun sendChat(text: String) { if (text.isNotBlank()) send(JSONObject().put("type", "chat").put("text", text.take(600))) }
    fun attachVideo(sink: (ByteArray) -> Unit) { videoSink = sink; send(JSONObject().put("type", "video-subscribe")) }
    fun detachVideo() { videoSink = null; if (mutable.value.room != null && mutable.value.online) send(JSONObject().put("type", "video-unsubscribe")); releaseControls() }
    fun videoError(message: String) { viewModelScope.launch { update { it.copy(gameplayError = message) } } }
    fun touches(contacts: JSONArray) { if (mutable.value.gameplayConnected) send(JSONObject().put("type", "input").put("contacts", contacts)) }
    fun releaseControls() { if (mutable.value.room != null && mutable.value.online) send(JSONObject().put("type", "input-release")) }
    fun importGame(uri: Uri) {
        if (mutable.value.importing) return
        update { it.copy(importing = true, importBytes = 0) }
        viewModelScope.launch {
            try {
                val game = library.importApk(uri) { bytes -> viewModelScope.launch { update { it.copy(importBytes = bytes) } } }
                val games = mutable.value.games.filterNot { it.id == game.id } + game
                withContext(Dispatchers.IO) { library.save(games) }
                update { it.copy(games = games) }
            } catch (error: Exception) { fail(error.message ?: "Could not import the APK.") }
            finally { update { it.copy(importing = false) } }
        }
    }
    override fun onCleared() { shuttingDown = true; generation++; upload?.cancel(); socket?.close(1000, "App closed"); videoSink = null; client.dispatcher.executorService.shutdown(); super.onCleared() }
}
