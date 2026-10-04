package dev.bridge.play

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.DigestOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream
import kotlin.coroutines.coroutineContext

data class LocalGame(
    val id: String, val title: String, val bytes: Long,
    val packageName: String, val version: String, val versionCode: Long,
    val minSdk: Int, val targetSdk: Int, val abis: List<String>,
    val certificates: List<String>, val kind: String = "apk",
    val format: String = "apk", val apkCount: Int = 1, val addedAt: Long = 0,
)
data class InstalledApp(val packageName: String, val title: String, val bytes: Long, val apkCount: Int, val isGame: Boolean, val readable: Boolean)

/** Reads only packages exposed by Android in this profile; never reads app-private data. */
class ApkLibrary(private val context: Context) {
    private val directory = File(context.filesDir, "apk-library").apply { mkdirs() }
    private val index = AtomicFile(File(directory, "library.json"))
    private val manager = context.packageManager
    private val signingFlags get() = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    fun file(game: LocalGame): File {
        require(game.id.matches(Regex("[a-f0-9]{64}"))) { "Invalid package identifier." }
        require(game.format in listOf("apk", "apk-set")) { "Unknown package format." }
        return File(directory, "${game.id}.${if (game.format == "apk-set") "apks" else "apk"}")
    }
    fun load(): List<LocalGame> = try {
        val array = JSONArray(index.openRead().bufferedReader().use { it.readText() })
        (0 until array.length()).map { decode(array.getJSONObject(it)) }.filter { file(it).isFile }
    } catch (_: Exception) { emptyList() }
    fun save(games: List<LocalGame>) {
        val array = JSONArray()
        games.forEach { game -> array.put(JSONObject().put("id", game.id).put("title", game.title).put("bytes", game.bytes)
            .put("package", game.packageName).put("version", game.version).put("versionCode", game.versionCode)
            .put("minSdk", game.minSdk).put("targetSdk", game.targetSdk).put("abis", JSONArray(game.abis)).put("certificates", JSONArray(game.certificates))
            .put("format", game.format).put("apkCount", game.apkCount).put("addedAt", game.addedAt)) }
        val output = index.startWrite()
        try { output.write(array.toString().toByteArray()); index.finishWrite(output) }
        catch (error: Exception) { index.failWrite(output); throw error }
    }
    fun removeCopy(game: LocalGame) { file(game).delete(); File(directory, "${game.id}.png").delete() }
    private fun decode(value: JSONObject) = LocalGame(value.getString("id"), value.getString("title"), value.getLong("bytes"),
        value.getString("package"), value.getString("version"), value.getLong("versionCode"), value.getInt("minSdk"), value.getInt("targetSdk"),
        value.getJSONArray("abis").strings(), value.getJSONArray("certificates").strings(), format = value.optString("format", "apk"),
        apkCount = value.optInt("apkCount", 1), addedAt = value.optLong("addedAt", 0))
    private fun JSONArray.strings() = (0 until length()).map { getString(it) }
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun packageFiles(app: ApplicationInfo): List<File> = listOf(File(app.sourceDir)) + (app.splitSourceDirs?.map { File(it) }?.sortedBy { it.name } ?: emptyList())

    @Suppress("DEPRECATION")
    suspend fun installedApps(): List<InstalledApp> = withContext(Dispatchers.IO) {
        manager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .mapNotNull { it.activityInfo?.applicationInfo }.distinctBy { it.packageName }
            .filter { it.packageName != context.packageName && it.enabled }
            .map { app ->
                ensureActive()
                val files = packageFiles(app)
                InstalledApp(app.packageName, app.loadLabel(manager).toString(), files.sumOf { it.length() }, files.size,
                    app.category == ApplicationInfo.CATEGORY_GAME || app.flags and ApplicationInfo.FLAG_IS_GAME != 0,
                    files.all { it.isFile && it.canRead() })
            }.sortedWith(compareByDescending<InstalledApp> { it.isGame }.thenBy { it.title.lowercase() })
    }

    private suspend fun copyBounded(input: InputStream, output: OutputStream, alreadyCopied: Long, onBytes: (Long) -> Unit): Long {
        var count = alreadyCopied
        val buffer = ByteArray(128 * 1024)
        while (true) {
            coroutineContext.ensureActive()
            val read = input.read(buffer)
            if (read < 0) break
            count += read
            require(count <= MAX_BYTES) { "This package is larger than the current 512 MB limit." }
            output.write(buffer, 0, read)
            if (count % (1024 * 1024) < buffer.size) onBytes(count)
        }
        onBytes(count)
        return count
    }
    private fun abis(file: File): Set<String> {
        val result = sortedSetOf<String>()
        ZipFile(file).use { zip ->
            require(zip.getEntry("AndroidManifest.xml") != null) { "Select an Android APK. To add an installed app, use From this phone." }
            require(zip.size() <= 100_000) { "This APK contains too many entries." }
            val entries = zip.entries()
            while (entries.hasMoreElements()) {
                Regex("^lib/([^/]+)/[^/]+\\.so$").matchEntire(entries.nextElement().name)?.let { result.add(it.groupValues[1]) }
            }
        }
        return result
    }
    @Suppress("DEPRECATION")
    private fun metadata(info: PackageInfo, id: String, bytes: Long, abis: List<String>, format: String, count: Int): LocalGame {
        val app = info.applicationInfo ?: error("The APK has no application metadata.")
        val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
        require(!signatures.isNullOrEmpty()) { "The APK has no readable signing certificate." }
        return LocalGame(id, app.loadLabel(manager).toString().take(80).ifBlank { info.packageName }, bytes,
            info.packageName, info.versionName ?: "Unknown", if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong(),
            app.minSdkVersion, app.targetSdkVersion, abis, signatures.map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).hex() },
            format = format, apkCount = count, addedAt = System.currentTimeMillis())
    }
    private fun finish(temporary: File, game: LocalGame, info: PackageInfo): LocalGame {
        require(game.bytes in 1..MAX_BYTES) { "This package is larger than the current 512 MB limit." }
        val destination = file(game)
        val alreadyStored = destination.exists()
        if (!alreadyStored) require(temporary.renameTo(destination)) { "Could not save the imported app." }
        // Keep a small icon with the library copy, including APKs imported from files.
        if (info.applicationInfo?.sourceDir == temporary.path) {
            info.applicationInfo?.sourceDir = destination.path; info.applicationInfo?.publicSourceDir = destination.path
        }
        try {
            val drawable = info.applicationInfo?.loadIcon(manager)
            if (drawable != null) {
                val bitmap = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888)
                drawable.setBounds(0, 0, 96, 96); drawable.draw(Canvas(bitmap))
                File(directory, "${game.id}.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
            }
        } catch (_: Exception) { /* A missing icon does not invalidate the package. */ }
        try { save(listOf(game) + load().filterNot { it.id == game.id }) }
        catch (error: Exception) {
            if (!alreadyStored) { destination.delete(); File(directory, "${game.id}.png").delete() }
            throw error
        }
        return game
    }
    @Suppress("DEPRECATION")
    suspend fun importApk(uri: Uri, onBytes: (Long) -> Unit): LocalGame = withContext(Dispatchers.IO) {
        val temporary = File(directory, ".import-${UUID.randomUUID()}.apk")
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            context.contentResolver.openInputStream(uri)?.use { input ->
                DigestOutputStream(temporary.outputStream(), digest).use { output -> copyBounded(input, output, 0, onBytes) }
            } ?: error("Could not open the selected file.")
            val nativeAbis = abis(temporary)
            val info = manager.getPackageArchiveInfo(temporary.path, signingFlags)
                ?: error("Android could not read this APK. Try adding the installed app from this phone.")
            require(info.splitNames.isNullOrEmpty()) { "Add this app from your phone to include all of its package files." }
            info.applicationInfo?.sourceDir = temporary.path; info.applicationInfo?.publicSourceDir = temporary.path
            finish(temporary, metadata(info, digest.digest().hex(), temporary.length(), nativeAbis.toList(), "apk", 1), info)
        } finally { temporary.delete() }
    }
    @Suppress("DEPRECATION")
    suspend fun importInstalled(packageName: String, onBytes: (Long) -> Unit): LocalGame = withContext(Dispatchers.IO) {
        val info = manager.getPackageInfo(packageName, signingFlags)
        val app = info.applicationInfo ?: error("This app is no longer installed.")
        val sources = packageFiles(app)
        require(sources.size <= 128 && sources.all { it.isFile && it.canRead() }) { "Android does not allow copying this app’s package files." }
        require(sources.sumOf { it.length() } <= MAX_BYTES) { "This app is larger than the current 512 MB limit." }
        val format = if (sources.size == 1) "apk" else "apk-set"
        val temporary = File(directory, ".import-${UUID.randomUUID()}")
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            val nativeAbis = sortedSetOf<String>()
            DigestOutputStream(temporary.outputStream(), digest).use { output ->
                if (format == "apk") {
                    nativeAbis.addAll(abis(sources.first()))
                    sources.first().inputStream().use { copyBounded(it, output, 0, onBytes) }
                } else {
                    ZipOutputStream(output).use { zip ->
                        zip.setLevel(Deflater.NO_COMPRESSION)
                        var copied = 0L
                        sources.forEachIndexed { index, source ->
                            ensureActive(); nativeAbis.addAll(abis(source))
                            zip.putNextEntry(ZipEntry(if (index == 0) "base.apk" else "split-$index.apk").apply { time = 0L })
                            source.inputStream().use { copied = copyBounded(it, zip, copied, onBytes) }
                            zip.closeEntry()
                        }
                    }
                }
            }
            val current = manager.getPackageInfo(packageName, 0)
            require(current.lastUpdateTime == info.lastUpdateTime && current.applicationInfo?.let { packageFiles(it) } == sources) {
                "The app changed while it was being copied. Refresh the list and try again."
            }
            finish(temporary, metadata(info, digest.digest().hex(), temporary.length(), nativeAbis.toList(), format, sources.size), info)
        } finally { temporary.delete() }
    }
    companion object { const val MAX_BYTES = 512L * 1024 * 1024 }
}
