package dev.bridge.play

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle

private val Background = Color(0xFF101114)
private val Panel = Color(0xFF191B20)
private val Line = Color(0xFF2A2D35)
private val Foreground = Color(0xFFF2F3F5)
private val Secondary = Color(0xFF9C9FAB)
private val Accent = Color(0xFF6596FF)
private val Rect = RoundedCornerShape(2.dp)

class MainActivity : ComponentActivity() {
    private val model: BridgeModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); setContent { BridgeTheme { BridgeApp(model) } } }
    override fun onPause() { model.releaseControls(); super.onPause() }
}

@Composable
fun BridgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(primary = Accent, onPrimary = Background, background = Background, onBackground = Foreground, surface = Panel, onSurface = Foreground, surfaceVariant = Panel, onSurfaceVariant = Secondary, outline = Line),
        shapes = Shapes(extraSmall = Rect, small = Rect, medium = Rect, large = Rect, extraLarge = Rect),
        content = content,
    )
}

@Composable
private fun BridgeApp(model: BridgeModel) {
    val state by model.state.collectAsStateWithLifecycle()
    var tab by remember { mutableStateOf(0) }
    var selected by remember { mutableStateOf("") }
    var dialog by remember { mutableStateOf("") }
    val snack = remember { SnackbarHostState() }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(model::importGame) }
    LaunchedEffect(state.error) { state.error?.let { snack.showSnackbar(it); model.clearError() } }
    BackHandler(enabled = state.room != null || dialog.isNotEmpty()) { if (dialog.isNotEmpty()) dialog = "" else model.leaveRoom() }
    Surface(color = Background, modifier = Modifier.fillMaxSize()) {
        Scaffold(containerColor = Background, modifier = Modifier.safeDrawingPadding().imePadding(), snackbarHost = { SnackbarHost(snack) }, topBar = {
            Column {
                Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (state.room != null) IconButton(onClick = model::leaveRoom) { Icon(Icons.Outlined.ArrowBack, "Leave room") }
                    else Icon(painterResource(R.drawable.ic_bridge), null, Modifier.size(29.dp), tint = Color.Unspecified)
                    Spacer(Modifier.width(10.dp))
                    Text(if (state.room != null) state.room!!.title else "Bridge", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    if (state.room == null) IconButton(onClick = { dialog = "join" }) { Icon(Icons.Outlined.Login, "Join room", tint = Secondary) }
                    IconButton(onClick = { dialog = "settings" }) { Icon(Icons.Outlined.Settings, "Settings", tint = Secondary) }
                }
                HorizontalDivider(color = Line)
            }
        }, bottomBar = {
            if (state.room == null) Column {
                if (tab == 0 && state.games.isNotEmpty()) {
                    val game = state.games.find { it.id == selected } ?: state.games.first()
                    Row(Modifier.fillMaxWidth().background(Panel).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(game.title, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1); Spacer(Modifier.height(4.dp)); Text("Android APK", color = Secondary, fontSize = 12.sp) }
                        PrimaryButton("Create room", enabled = state.online && state.runtimeAvailable && !state.busy) { dialog = "host" }
                    }
                }
                HorizontalDivider(color = Line)
                Row(Modifier.fillMaxWidth().background(Background)) {
                    TabButton("Games", Icons.Outlined.SportsEsports, tab == 0, Modifier.weight(1f)) { tab = 0 }
                    TabButton("Rooms", Icons.Outlined.PeopleOutline, tab == 1, Modifier.weight(1f)) { tab = 1 }
                }
            }
        }) { padding ->
            Box(Modifier.padding(padding).fillMaxSize()) {
                if (state.room != null) RoomScreen(state, model)
                else if (tab == 0) LibraryScreen(state, selected, { selected = it }, { importer.launch(arrayOf("application/vnd.android.package-archive", "application/octet-stream")) }, { dialog = "settings" })
                else RoomListScreen { dialog = "join" }
            }
        }
    }
    if (dialog.isNotEmpty()) {
        var name by remember(dialog) { mutableStateOf(state.name) }
        var code by remember(dialog) { mutableStateOf("") }
        var server by remember(dialog) { mutableStateOf(state.server) }
        val title = when (dialog) { "settings" -> "Settings"; "join" -> "Join room"; else -> "Create room" }
        Dialog(onDismissRequest = { dialog = "" }) {
            Surface(shape = Rect, color = Panel, border = BorderStroke(1.dp, Line)) {
                Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Text(title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)); IconButton(onClick = { dialog = "" }, modifier = Modifier.size(28.dp)) { Icon(Icons.Outlined.Close, "Close", tint = Secondary) } }
                    OutlinedTextField(value = name, onValueChange = { name = it.take(24) }, label = { Text("Player name") }, singleLine = true, shape = Rect, modifier = Modifier.fillMaxWidth())
                    if (dialog == "join") {
                        OutlinedTextField(value = code, onValueChange = { code = it.filter(Char::isLetterOrDigit).uppercase().take(6) }, label = { Text("Room code") }, singleLine = true, shape = Rect, modifier = Modifier.fillMaxWidth())
                        Text("Enter the six-character code from your friend.", color = Secondary, fontSize = 12.sp, lineHeight = 18.sp)
                    }
                    if (dialog == "settings") {
                        OutlinedTextField(value = server, onValueChange = { server = it }, label = { Text("Room server") }, singleLine = true, shape = Rect, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
                        Text("Use your server’s HTTPS address for internet play. The local test server runs on port 3210.", color = Secondary, fontSize = 12.sp, lineHeight = 18.sp)
                    }
                    if (dialog == "host") Text((state.games.find { it.id == selected } ?: state.games.first()).title + " · Private room\nThe APK will run on your configured Android host.", color = Secondary, fontSize = 13.sp)
                    PrimaryButton(when (dialog) { "settings" -> "Save and connect"; "join" -> "Join room"; else -> "Create room" }, enabled = name.isNotBlank() && (dialog != "join" || code.length == 6), modifier = Modifier.fillMaxWidth()) {
                        model.saveName(name)
                        when (dialog) { "settings" -> model.saveServer(server); "join" -> model.joinRoom(code); else -> model.createRoom(state.games.find { it.id == selected } ?: state.games.first()) }
                        dialog = ""
                    }
                }
            }
        }
    }
}

@Composable
private fun LibraryScreen(state: BridgeState, selected: String, onSelect: (String) -> Unit, onImport: () -> Unit, onSettings: () -> Unit) {
    var search by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().clickable(onClick = onSettings).padding(horizontal = 20.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(6.dp).background(if (state.online) Color(0xFF5CB98D) else Secondary, Rect))
            Spacer(Modifier.width(9.dp)); Text(if (state.online) if (state.runtimeAvailable) "Android host available" else "Android host unavailable" else if (state.connecting) "Connecting to room server" else "Room server offline", color = Secondary, fontSize = 12.sp)
            Spacer(Modifier.weight(1f)); if (!state.online || !state.runtimeAvailable) Text("Configure", color = Accent, fontSize = 12.sp)
        }
        HorizontalDivider(color = Line)
        Row(Modifier.fillMaxWidth().padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("Library", fontSize = 25.sp, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(5.dp)); Text("${state.games.size} game${if (state.games.size == 1) "" else "s"} on this device", fontSize = 12.sp, color = Secondary) }
            OutlinedButton(onClick = onImport, enabled = !state.importing, shape = Rect, border = BorderStroke(1.dp, Line), contentPadding = PaddingValues(horizontal = 13.dp, vertical = 9.dp)) { Icon(Icons.Outlined.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(if (state.importing) "Importing…" else "Import APK", fontSize = 13.sp) }
        }
        OutlinedTextField(value = search, onValueChange = { search = it }, placeholder = { Text("Search games", color = Secondary, fontSize = 14.sp) }, leadingIcon = { Icon(Icons.Outlined.Search, null, tint = Secondary, modifier = Modifier.size(20.dp)) }, singleLine = true, shape = Rect, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp))
        Spacer(Modifier.height(20.dp))
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(state.games.filter { it.title.contains(search, ignoreCase = true) }, key = { it.id }) { game ->
                GameRow(game, (state.games.find { it.id == selected } ?: state.games.firstOrNull())?.id == game.id) { onSelect(game.id) }
            }
            if (state.games.none { it.title.contains(search, ignoreCase = true) }) item { Text(if (state.games.isEmpty()) "Import an APK to add an Android app to your library." else "No games match your search.", color = Secondary, fontSize = 13.sp, modifier = Modifier.padding(vertical = 20.dp)) }
        }
        Text(if (state.importing) "Reading APK · ${state.importBytes / (1024 * 1024)} MB" else "Package requirements are checked automatically. Multiplayer behavior depends on the app’s existing controls.", color = Secondary, fontSize = 11.sp, lineHeight = 17.sp, modifier = Modifier.padding(20.dp))
    }
}

@Composable
private fun GameRow(game: LocalGame, selected: Boolean, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(Rect).background(Panel).border(1.dp, if (selected) Accent else Line, Rect).clickable(onClick = onClick).padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(52.dp).background(Color(0xFF252A36), Rect), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.SportsEsports, null, tint = Accent, modifier = Modifier.size(25.dp)) }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) { Text(game.title, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis); Spacer(Modifier.height(7.dp)); Text("${game.version} · ${(game.bytes / (1024 * 1024)).coerceAtLeast(1)} MB", color = Secondary, fontSize = 12.sp); Spacer(Modifier.height(4.dp)); Text(game.packageName, color = Secondary, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis); Spacer(Modifier.height(4.dp)); Text("API ${game.minSdk}+ · ${game.abis.joinToString().ifBlank { "No native libraries" }}", color = Secondary, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        if (selected) { Spacer(Modifier.width(10.dp)); Icon(Icons.Outlined.Check, "Selected", tint = Accent, modifier = Modifier.size(19.dp)) }
    }
}

@Composable
private fun RoomListScreen(onJoin: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Text("Rooms", fontSize = 25.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(24.dp)); HorizontalDivider(color = Line)
        Row(Modifier.fillMaxWidth().padding(vertical = 22.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.MeetingRoom, null, tint = Secondary, modifier = Modifier.size(24.dp)); Spacer(Modifier.width(15.dp))
            Column(Modifier.weight(1f)) { Text("No active room", fontSize = 15.sp, fontWeight = FontWeight.Medium); Spacer(Modifier.height(6.dp)); Text("Host a game or join with a room code.", color = Secondary, fontSize = 12.sp) }
        }
        PrimaryButton("Join room", modifier = Modifier.fillMaxWidth(), onClick = onJoin)
    }
}

@Composable
private fun RoomScreen(state: BridgeState, model: BridgeModel) {
    val room = state.room ?: return
    val keyboardOpen = WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val clipboard = LocalClipboardManager.current
    var chatText by remember(room.code) { mutableStateOf("") }
    val scroll = rememberLazyListState()
    LaunchedEffect(state.chat.size) { if (state.chat.isNotEmpty()) scroll.animateScrollToItem(state.chat.lastIndex) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("ROOM", fontSize = 10.sp, color = Secondary, letterSpacing = 1.sp)
            Spacer(Modifier.width(10.dp)); Text(room.code, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp)
            IconButton(onClick = { clipboard.setText(AnnotatedString(room.code)) }, modifier = Modifier.size(36.dp)) { Icon(Icons.Outlined.ContentCopy, "Copy room code", tint = Secondary, modifier = Modifier.size(16.dp)) }
            Spacer(Modifier.weight(1f)); Icon(Icons.Outlined.PeopleOutline, null, tint = Secondary, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(5.dp)); Text("${room.players.size}/2", color = Secondary, fontSize = 12.sp)
        }
        val runtime = room.runtime
        Box(Modifier.fillMaxWidth().height(if (keyboardOpen) 140.dp else 300.dp).background(Color.Black), contentAlignment = Alignment.Center) {
            if (runtime != null && runtime.width > 0 && runtime.height > 0) {
                key(room.code, runtime.streamId, runtime.width, runtime.height) { GameSurface(model, runtime.width, runtime.height, Modifier.fillMaxSize()) }
            } else Text(runtime?.message ?: "Preparing the Android session", color = Secondary, fontSize = 13.sp, modifier = Modifier.padding(24.dp))
        }
        Row(Modifier.fillMaxWidth().background(Panel).padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(runtime?.message ?: "Waiting for the Android host", fontSize = 12.sp, color = if (state.gameplayConnected) Color(0xFF5CB98D) else Secondary)
                Text("Player ${if (state.role == "host") "1" else "2"} · Touch the game to control it", fontSize = 11.sp, color = Secondary, modifier = Modifier.padding(top = 5.dp))
            }
            state.ping?.let { Text("$it ms", color = Secondary, fontSize = 10.sp) }
        }
        state.gameplayError?.let { Text(it, color = Color(0xFFFFB4AB), fontSize = 12.sp, modifier = Modifier.padding(16.dp)) }
        HorizontalDivider(color = Line)
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.ChatBubbleOutline, null, Modifier.size(17.dp), tint = Secondary); Spacer(Modifier.width(9.dp)); Text("Chat", fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.weight(1f)); Text("Text only", color = Secondary, fontSize = 11.sp)
        }
        LazyColumn(state = scroll, modifier = Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.chat.isEmpty()) item { Text("No messages yet.", color = Secondary, fontSize = 12.sp, modifier = Modifier.padding(vertical = 10.dp)) }
            items(state.chat, key = { it.id }) { message -> Column { Text(if (message.mine) "You" else message.name, color = if (message.mine) Accent else Secondary, fontSize = 10.sp, fontWeight = FontWeight.Medium); Spacer(Modifier.height(4.dp)); Text(message.text, fontSize = 13.sp, lineHeight = 19.sp) } }
        }
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = chatText, onValueChange = { chatText = it.take(600) }, placeholder = { Text("Message", color = Secondary, fontSize = 13.sp) }, shape = Rect, modifier = Modifier.weight(1f), maxLines = 3)
            IconButton(onClick = { model.sendChat(chatText); chatText = "" }, enabled = chatText.isNotBlank()) { Icon(Icons.Outlined.Send, "Send message", tint = if (chatText.isNotBlank()) Accent else Secondary) }
        }
    }
}

@Composable
private fun PrimaryButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled, shape = Rect, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 11.dp), modifier = modifier.heightIn(min = 44.dp)) { Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun TabButton(text: String, icon: ImageVector, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.clickable(onClick = onClick).padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Icon(icon, null, Modifier.size(22.dp), tint = if (selected) Accent else Secondary)
        Text(text, fontSize = 11.sp, fontWeight = if (selected) FontWeight.Medium else FontWeight.Normal, color = if (selected) Accent else Secondary)
    }
}

@Preview(showBackground = true, widthDp = 390, heightDp = 844)
@Composable
private fun NativeLibraryPreview() {
    BridgeTheme { Surface(color = Background) { LibraryScreen(BridgeState(online = true, connecting = false), "", {}, {}, {}) } }
}
