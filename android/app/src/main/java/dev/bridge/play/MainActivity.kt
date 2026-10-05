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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle

internal val Background = Color(0xFF101114)
internal val Panel = Color(0xFF191B20)
internal val Line = Color(0xFF2A2D35)
internal val Foreground = Color(0xFFF2F3F5)
internal val Secondary = Color(0xFF9C9FAB)
internal val Accent = Color(0xFF6596FF)
internal val Rect = RoundedCornerShape(2.dp)

class MainActivity : ComponentActivity() {
    private val model: BridgeModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); setContent { BridgeTheme { BridgeApp(model) } } }
    override fun onPause() { model.releaseControls(); super.onPause() }
}

@Composable
fun BridgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(primary = Accent, onPrimary = Background, background = Background, onBackground = Foreground, surface = Panel, onSurface = Foreground, surfaceVariant = Panel, onSurfaceVariant = Secondary, outline = Line),
        shapes = Shapes(extraSmall = Rect, small = Rect, medium = Rect, large = Rect, extraLarge = Rect), content = content,
    )
}

@Composable
private fun BridgeApp(model: BridgeModel) {
    val state by model.state.collectAsStateWithLifecycle()
    var route by rememberSaveable { mutableStateOf("library") }
    var parentRoute by rememberSaveable { mutableStateOf("library") }
    var selectedId by rememberSaveable { mutableStateOf("") }
    var dialog by rememberSaveable { mutableStateOf("") }
    var observedAdd by remember { mutableIntStateOf(state.addSequence) }
    val selected = state.games.find { it.id == selectedId }
    val snack = remember { SnackbarHostState() }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(model::importGame) }
    val importFile = { importer.launch(arrayOf("application/vnd.android.package-archive", "application/octet-stream")) }
    val addFromPhone = { parentRoute = route; route = "installed" }
    val openGame: (LocalGame) -> Unit = { selectedId = it.id; parentRoute = "library"; route = "details" }
    LaunchedEffect(state.error, state.notice) { (state.error ?: state.notice)?.let { snack.showSnackbar(it); model.clearError() } }
    LaunchedEffect(state.addSequence) {
        if (state.addSequence > observedAdd) {
            observedAdd = state.addSequence; selectedId = state.lastAddedId ?: ""; parentRoute = "library"; route = "details"
        }
    }
    LaunchedEffect(route) { if (route == "installed") model.refreshInstalledApps() }
    fun back() {
        when {
            dialog.isNotEmpty() -> dialog = ""
            state.room != null -> dialog = "leave"
            route in listOf("installed", "details") -> route = parentRoute.takeUnless { it in listOf("installed", "details") } ?: "library"
            else -> route = "library"
        }
    }
    BackHandler(state.room != null || route != "library" || dialog.isNotEmpty()) { back() }
    val nested = state.room != null || route in listOf("installed", "details")
    Surface(color = Background, modifier = Modifier.fillMaxSize()) {
        Scaffold(containerColor = Background, modifier = Modifier.safeDrawingPadding().imePadding(), snackbarHost = { SnackbarHost(snack) }, topBar = {
            Column {
                Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (nested) IconButton(onClick = { back() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") }
                    else Icon(painterResource(R.drawable.ic_bridge), null, Modifier.size(28.dp), tint = Color.Unspecified)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(when { state.room != null -> state.room!!.title; route == "installed" -> "Add from this phone"; route == "details" -> "Game details"; route == "settings" -> "Settings"; route == "play" -> "Rooms"; else -> "Library" }, fontSize = 19.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (route == "library" && state.room == null && state.games.isNotEmpty()) TextButton(onClick = addFromPhone, enabled = !state.importing) { Icon(Icons.Outlined.Add, null, Modifier.size(17.dp)); Spacer(Modifier.width(5.dp)); Text("Add game", fontSize = 12.sp) }
                    if (route == "installed" && state.room == null) IconButton(onClick = model::refreshInstalledApps, enabled = !state.scanningApps) { Icon(Icons.Outlined.Refresh, "Refresh installed apps", tint = Secondary) }
                }
                HorizontalDivider(color = Line)
            }
        }, bottomBar = {
            if (!nested) Column {
                HorizontalDivider(color = Line)
                Row(Modifier.fillMaxWidth().background(Background)) {
                    NavItem("Library", Icons.Outlined.SportsEsports, route == "library", Modifier.weight(1f)) { route = "library" }
                    NavItem("Rooms", Icons.Outlined.PeopleOutline, route == "play", Modifier.weight(1f)) { route = "play" }
                    NavItem("Settings", Icons.Outlined.Settings, route == "settings", Modifier.weight(1f)) { route = "settings" }
                }
            }
        }) { padding ->
            Column(Modifier.padding(padding).fillMaxSize()) {
                if (state.importing) ImportProgress(state, model::cancelImport)
                Box(Modifier.weight(1f)) {
                    if (state.room != null) RoomScreen(state, model)
                    else when (route) {
                        "installed" -> InstalledAppsScreen(state, model::importInstalled, importFile)
                        "details" -> if (selected != null) GameDetailsScreen(selected, state, { dialog = "host" }, { dialog = "remove" }) else GameLibraryScreen(state, addFromPhone, importFile, openGame)
                        "library" -> GameLibraryScreen(state, addFromPhone, importFile, openGame)
                        "settings" -> SettingsScreen(state, { name, server -> model.saveName(name); model.saveServer(server) }, model::refreshConnection)
                        else -> RoomLobbyScreen(state, { if (state.games.isEmpty()) addFromPhone() else route = "library" }, { dialog = "join" })
                    }
                }
            }
        }
    }
    if (dialog in listOf("join", "host")) {
        var name by remember(dialog) { mutableStateOf(state.name) }
        var code by remember(dialog) { mutableStateOf("") }
        val hosting = dialog == "host"
        Dialog(onDismissRequest = { dialog = "" }) {
            Surface(shape = Rect, color = Panel, border = BorderStroke(1.dp, Line)) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (hosting) "Host a game" else "Join a friend", fontSize = 21.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        IconButton(onClick = { dialog = "" }) { Icon(Icons.Outlined.Close, "Close", tint = Secondary) }
                    }
                    if (hosting && selected != null) Text(selected.title, color = Secondary, fontSize = 14.sp)
                    OutlinedTextField(name, { name = it.take(24) }, label = { Text("Player name") }, singleLine = true, shape = Rect, modifier = Modifier.fillMaxWidth())
                    if (!hosting) OutlinedTextField(code, { code = it.filter(Char::isLetterOrDigit).uppercase().take(6) }, label = { Text("Room code") }, supportingText = { Text("Ask your friend for their six-character code.") }, singleLine = true, shape = Rect, modifier = Modifier.fillMaxWidth())
                    if (!state.online || hosting && !state.runtimeAvailable) {
                        Text(if (!state.online) "Connect to a session server before joining or hosting." else "The gameplay service is unavailable. The room server needs a running Android host before it can start a game.", color = Secondary, fontSize = 13.sp, lineHeight = 19.sp)
                        OutlinedButton(onClick = { dialog = ""; route = "settings" }, shape = Rect, modifier = Modifier.fillMaxWidth()) { Text("Connection settings") }
                    }
                    if (hosting) Text("Bridge uploads its library copy to the session server. Share the room code once the room opens.", fontSize = 12.sp, lineHeight = 18.sp, color = Secondary)
                    PrimaryButton(if (hosting) "Create room" else "Join room", enabled = state.online && !state.busy && name.isNotBlank() && (if (hosting) state.runtimeAvailable && selected != null else code.length == 6), modifier = Modifier.fillMaxWidth()) {
                        model.saveName(name)
                        if (hosting && selected != null) model.createRoom(selected) else model.joinRoom(code)
                        dialog = ""
                    }
                }
            }
        }
    }
    if (dialog == "remove" && selected != null) AlertDialog(onDismissRequest = { dialog = "" }, shape = Rect,
        title = { Text("Remove ${selected.title}?") }, text = { Text("This removes Bridge’s library copy. The installed app and its saves stay on your phone.") },
        confirmButton = { TextButton(onClick = { model.removeGame(selected); dialog = ""; route = "library" }) { Text("Remove copy") } },
        dismissButton = { TextButton(onClick = { dialog = "" }) { Text("Cancel") } })
    if (dialog == "leave") AlertDialog(onDismissRequest = { dialog = "" }, shape = Rect,
        title = { Text("Leave this room?") }, text = { Text(if (state.role == "host") "Leaving ends the shared session for both players." else "Your friend can stay in the room.") },
        confirmButton = { TextButton(onClick = { model.leaveRoom(); dialog = ""; route = "play" }) { Text("Leave room") } },
        dismissButton = { TextButton(onClick = { dialog = "" }) { Text("Stay") } })
}

@Composable
internal fun PrimaryButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled, shape = Rect, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp), modifier = modifier.heightIn(min = 48.dp)) { Text(text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
}

@Composable
private fun NavItem(text: String, icon: ImageVector, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.clickable(onClick = onClick), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.fillMaxWidth().height(2.dp).background(if (selected) Accent else Background))
        Column(Modifier.padding(vertical = 13.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Icon(icon, null, Modifier.size(22.dp), tint = if (selected) Accent else Secondary)
            Text(text, fontSize = 11.sp, fontWeight = FontWeight.Medium, color = if (selected) Foreground else Secondary)
        }
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
            IconButton(onClick = { model.sendChat(chatText); chatText = "" }, enabled = chatText.isNotBlank()) { Icon(Icons.AutoMirrored.Outlined.Send, "Send message", tint = if (chatText.isNotBlank()) Accent else Secondary) }
        }
    }
}
