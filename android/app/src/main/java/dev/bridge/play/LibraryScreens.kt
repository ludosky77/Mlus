package dev.bridge.play

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale

private fun sizeLabel(bytes: Long): String = if (bytes < 1024 * 1024) "${bytes / 1024} KB" else String.format(Locale.getDefault(), "%.1f MB", bytes / (1024.0 * 1024))

@Composable
internal fun RoomLobbyScreen(state: BridgeState, onHost: () -> Unit, onJoin: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Spacer(Modifier.height(12.dp))
        Text("Play with a friend", fontSize = 23.sp, fontWeight = FontWeight.SemiBold)
        Text("Host a game from your library, or join with a room code.", color = Secondary, fontSize = 13.sp, lineHeight = 21.sp)
        Spacer(Modifier.height(6.dp))
        PrimaryButton("Host a game", modifier = Modifier.fillMaxWidth(), onClick = onHost)
        OutlinedButton(onClick = onJoin, shape = Rect, border = BorderStroke(1.dp, Line), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Join a room") }
        if (!state.online || !state.runtimeAvailable) Text("Online gameplay is not connected yet. You can add games to your library while setup is unfinished.", color = Secondary, fontSize = 12.sp, lineHeight = 20.sp)
    }
}

@Composable
private fun EmptyLibrary(enabled: Boolean, onAdd: () -> Unit, onFile: () -> Unit) {
    Box(Modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Icon(Icons.Outlined.SportsEsports, null, tint = Secondary, modifier = Modifier.size(42.dp))
            Text("Add your first game", fontSize = 21.sp, fontWeight = FontWeight.SemiBold)
            Text("Choose an app already on your phone.", color = Secondary, fontSize = 13.sp)
            Spacer(Modifier.height(4.dp))
            PrimaryButton("Choose installed app", enabled, Modifier.fillMaxWidth(), onAdd)
            TextButton(onClick = onFile, enabled = enabled) { Text("Import an APK file", fontSize = 12.sp) }
        }
    }
}

@Composable
internal fun GameLibraryScreen(state: BridgeState, onAdd: () -> Unit, onFile: () -> Unit, onGame: (LocalGame) -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    if (state.games.isEmpty()) { EmptyLibrary(!state.importing, onAdd, onFile); return }
    val games = state.games.filter { it.title.contains(query, true) || it.packageName.contains(query, true) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 18.dp)) {
        item { SearchField(query, { query = it }, "Search your library"); Spacer(Modifier.height(16.dp)) }
        items(games, key = { it.id }) { game ->
            GameListRow(game, { onGame(game) })
            HorizontalDivider(Modifier.padding(start = 64.dp), color = Line)
        }
        if (games.isEmpty()) item { Text("No matching apps.", color = Secondary, fontSize = 13.sp, modifier = Modifier.padding(vertical = 24.dp)) }
    }
}

@Composable
internal fun InstalledAppsScreen(state: BridgeState, onImport: (InstalledApp) -> Unit, onFile: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var gamesOnly by rememberSaveable { mutableStateOf(false) }
    val apps = state.installedApps.filter { (!gamesOnly || it.isGame) && (it.title.contains(query, true) || it.packageName.contains(query, true)) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item { SearchField(query, { query = it }, "Search installed apps") }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                FilterChip(selected = !gamesOnly, onClick = { gamesOnly = false }, label = { Text("All apps") }, shape = Rect)
                FilterChip(selected = gamesOnly, onClick = { gamesOnly = true }, label = { Text("Games") }, shape = Rect)
                Spacer(Modifier.weight(1f)); Text("${apps.size} found", fontSize = 11.sp, color = Secondary)
            }
        }
        if (state.scanningApps) item { LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = Accent, trackColor = Line) }
        items(apps, key = { it.packageName }) { app ->
            val added = state.games.any { it.packageName == app.packageName }
            Column {
                Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    AppIcon(app.packageName)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(app.title, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(if (!app.readable) "Package access unavailable" else sizeLabel(app.bytes), fontSize = 11.sp, color = Secondary)
                    }
                    Spacer(Modifier.width(6.dp))
                    IconButton(onClick = { onImport(app) }, enabled = !state.importing && app.readable && app.bytes <= ApkLibrary.MAX_BYTES) {
                        Icon(if (added) Icons.Outlined.Refresh else Icons.Outlined.Add, if (added) "Copy latest ${app.title}" else "Add ${app.title}", tint = if (!state.importing && app.readable && app.bytes <= ApkLibrary.MAX_BYTES) Accent else Secondary)
                    }
                }
                HorizontalDivider(Modifier.padding(start = 58.dp), color = Line)
            }
        }
        if (!state.scanningApps && apps.isEmpty()) item { Text(if (gamesOnly) "No apps are marked as games by Android. Try All apps." else "No matching installed apps are visible in this Android profile.", color = Secondary, fontSize = 13.sp, lineHeight = 20.sp) }
        item {
            Text("Apps up to 512 MB. Your saves stay in the original app.", color = Secondary, fontSize = 11.sp, lineHeight = 18.sp)
            TextButton(onClick = onFile, enabled = !state.importing) { Text("Import an APK file instead", fontSize = 12.sp) }
        }
    }
}

@Composable
internal fun GameDetailsScreen(game: LocalGame, state: BridgeState, onHost: () -> Unit, onRemove: () -> Unit) {
    var expanded by rememberSaveable(game.id) { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIcon(game.packageName, game.id, Modifier.size(64.dp))
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(game.title, fontSize = 23.sp, fontWeight = FontWeight.SemiBold)
                    Text("Version ${game.version}", fontSize = 12.sp, color = Secondary)
                    Text("${sizeLabel(game.bytes)} stored in Bridge", fontSize = 12.sp, color = Secondary)
                }
            }
        }
        item {
            PrimaryButton("Host this game", !state.busy, Modifier.fillMaxWidth(), onHost)
            Spacer(Modifier.height(12.dp))
            Text("Create a private room and share its code with a friend.", color = Secondary, fontSize = 12.sp, lineHeight = 20.sp)
        }
        item {
            Row(Modifier.fillMaxWidth().clickable { expanded = !expanded }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Info, null, Modifier.size(19.dp), tint = Secondary); Spacer(Modifier.width(10.dp))
                Text("Package details", Modifier.weight(1f), fontSize = 14.sp)
                Icon(if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, if (expanded) "Hide package details" else "Show package details", tint = Secondary)
            }
            if (expanded) Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 12.dp)) {
                DetailLine("Package files", "${game.apkCount} ${if (game.apkCount == 1) "APK" else "APKs"}")
                DetailLine("Package", game.packageName)
                DetailLine("Android requirement", "API ${game.minSdk} or later")
                DetailLine("Native libraries", game.abis.joinToString().ifBlank { "None" })
                DetailLine("Import", if (game.format == "apk-set") "Base APK and installed splits" else "Single APK")
                Text("Package checks do not guarantee that the app will run on the session host or support two independent players.", fontSize = 11.sp, color = Secondary, lineHeight = 18.sp)
            }
        }
        item {
            HorizontalDivider(color = Line)
            TextButton(onClick = onRemove, enabled = !state.importing) { Icon(Icons.Outlined.DeleteOutline, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Remove library copy", fontSize = 12.sp) }
        }
    }
}

@Composable
internal fun SettingsScreen(state: BridgeState, onSave: (String, String) -> Unit, onRefresh: () -> Unit) {
    var name by rememberSaveable(state.name) { mutableStateOf(state.name) }
    var server by rememberSaveable(state.server) { mutableStateOf(state.server) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
        item {
            Text("Player profile", fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(name, { name = it.take(24) }, label = { Text("Player name") }, supportingText = { Text("Shown to your friend in rooms and chat.") }, singleLine = true, shape = Rect, modifier = Modifier.fillMaxWidth())
        }
        item {
            HorizontalDivider(color = Line); Spacer(Modifier.height(22.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Online connection", Modifier.weight(1f), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                IconButton(onClick = onRefresh, enabled = !state.connecting) { Icon(Icons.Outlined.Refresh, "Check connection", tint = Secondary) }
            }
            Text(if (state.online && state.runtimeAvailable) "Online gameplay ready" else if (state.online) "Room server connected · gameplay service unavailable" else if (state.connecting) "Checking connection…" else "Not connected", color = if (state.online) Accent else Secondary, fontSize = 12.sp)
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(server, { server = it }, label = { Text("Session server") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), singleLine = true, shape = Rect, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(10.dp))
            Text("This development build needs a configured server for online play. Library import works without a connection. Both players must use the same server.", color = Secondary, fontSize = 12.sp, lineHeight = 19.sp)
        }
        item { PrimaryButton("Save & connect", server.isNotBlank(), Modifier.fillMaxWidth()) { onSave(name, server) } }
        item {
            HorizontalDivider(color = Line); Spacer(Modifier.height(18.dp))
            DetailLine("Bridge", "Native Android · 0.2.1")
            Spacer(Modifier.height(12.dp))
            Text("Chat supports text only. Game video is part of the shared session.", fontSize = 12.sp, lineHeight = 19.sp, color = Secondary)
        }
    }
}

@Composable
internal fun ImportProgress(state: BridgeState, onCancel: () -> Unit) {
    Column(Modifier.fillMaxWidth().background(Panel)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Adding ${state.importingTitle}", fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${sizeLabel(state.importBytes)} copied", fontSize = 11.sp, color = Secondary)
            }
            TextButton(onClick = onCancel) { Text("Cancel", fontSize = 11.sp) }
        }
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth().height(2.dp), color = Accent, trackColor = Line)
    }
}

@Composable
private fun SearchField(value: String, onValue: (String) -> Unit, hint: String) {
    OutlinedTextField(value, onValue, placeholder = { Text(hint, fontSize = 13.sp) }, leadingIcon = { Icon(Icons.Outlined.Search, null, Modifier.size(20.dp)) }, singleLine = true, shape = Rect, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun GameListRow(game: LocalGame, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
        AppIcon(game.packageName, game.id)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(game.title, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(sizeLabel(game.bytes), fontSize = 11.sp, color = Secondary)
        }
        Icon(Icons.AutoMirrored.Outlined.ArrowForward, "Game details", Modifier.size(17.dp), tint = Secondary)
    }
}

@Composable
private fun DetailLine(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) { Text(label, fontSize = 11.sp, color = Secondary); Text(value, fontSize = 13.sp, lineHeight = 19.sp) }
}

@Composable
private fun AppIcon(packageName: String, gameId: String? = null, modifier: Modifier = Modifier.size(46.dp)) {
    val context = LocalContext.current
    val bitmap by produceState<Bitmap?>(null, packageName, gameId) {
        value = withContext(Dispatchers.IO) {
            try {
                val saved = gameId?.takeIf { it.matches(Regex("[a-f0-9]{64}")) }?.let { File(context.filesDir, "apk-library/$it.png") }
                if (saved?.isFile == true) BitmapFactory.decodeFile(saved.path)
                else {
                    val drawable = context.packageManager.getApplicationIcon(packageName)
                    Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888).also { drawable.setBounds(0, 0, 96, 96); drawable.draw(Canvas(it)) }
                }
            } catch (_: Exception) { null }
        }
    }
    Box(modifier.clip(RoundedCornerShape(2.dp)).background(Line), contentAlignment = Alignment.Center) {
        bitmap?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize()) } ?: Icon(Icons.Outlined.SportsEsports, null, Modifier.size(24.dp), tint = Secondary)
    }
}

@Preview(showBackground = true, widthDp = 390, heightDp = 844)
@Composable
private fun LibraryPreview() { BridgeTheme { Surface(color = Background) { GameLibraryScreen(BridgeState(connecting = false), {}, {}, {}) } } }
