package dev.bridge.play

import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipFile

data class LocalGame(
    val id: String, val title: String, val bytes: Long,
    val packageName: String, val version: String, val versionCode: Long,
    val minSdk: Int, val targetSdk: Int, val abis: List<String>,
    val certificates: List<String>, val kind: String = "apk",
)

/** Imports packages as data. Execution happens only on the configured Android host. */
class ApkLibrary(private val context: Context) {
    private val directory = File(context.filesDir, "apk-library").apply { mkdirs() }
    private val index = AtomicFile(File(directory, "library.json"))
    fun file(game: LocalGame): File {
        require(game.id.matches(Regex("[a-f0-9]{64}"))) { "Invalid package identifier." }
        return File(directory, "${game.id}.apk")
    }
    fun load(): List<LocalGame> = try {
        val array = JSONArray(index.openRead().bufferedReader().use { it.readText() })
        (0 until array.length()).map { decode(array.getJSONObject(it)) }.filter { file(it).isFile }
    } catch (_: Exception) { emptyList() }
    fun save(games: List<LocalGame>) {
        val array = JSONArray()
        games.forEach { game -> array.put(JSONObject().put("id", game.id).put("title", game.title).put("bytes", game.bytes)
            .put("package", game.packageName).put("version", game.version).put("versionCode", game.versionCode)
            .put("minSdk", game.minSdk).put("targetSdk", game.targetSdk).put("abis", JSONArray(game.abis)).put("certificates", JSONArray(game.certificates))) }
        val output = index.startWrite()
        try { output.write(array.toString().toByteArray()); index.finishWrite(output) }
        catch (error: Exception) { index.failWrite(output); throw error }
    }
    private fun decode(value: JSONObject) = LocalGame(value.getString("id"), value.getString("title"), value.getLong("bytes"),
        value.getString("package"), value.getString("version"), value.getLong("versionCode"), value.getInt("minSdk"), value.getInt("targetSdk"),
        value.getJSONArray("abis").strings(), value.getJSONArray("certificates").strings())
    private fun JSONArray.strings() = (0 until length()).map { getString(it) }
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it.toInt() and 255) }

    @Suppress("DEPRECATION")
    suspend fun importApk(uri: Uri, onBytes: (Long) -> Unit): LocalGame = withContext(Dispatchers.IO) {
        val temporary = File(directory, ".import-${UUID.randomUUID()}.apk")
        try {
            var count = 0L
            val digest = MessageDigest.getInstance("SHA-256")
            context.contentResolver.openInputStream(uri)?.use { input ->
                temporary.outputStream().use { output ->
                    val buffer = ByteArray(128 * 1024)
                    while (true) {
                        ensureActive()
                        val read = input.read(buffer)
                        if (read < 0) break
                        count += read
                        require(count <= MAX_BYTES) { "This host upload limit is 512 MB per APK." }
                        output.write(buffer, 0, read); digest.update(buffer, 0, read)
                        if (count % (1024 * 1024) < buffer.size) onBytes(count)
                    }
                }
            } ?: error("Could not open the selected file.")
            require(count > 0) { "The selected file is empty." }
            val abis = sortedSetOf<String>()
            ZipFile(temporary).use { zip ->
                require(zip.getEntry("AndroidManifest.xml") != null) { "Select an Android APK. APK bundles and split package sets are not supported yet." }
                require(zip.size() <= 100_000) { "This APK contains too many entries." }
                val entries = zip.entries()
                while (entries.hasMoreElements()) {
                    val name = entries.nextElement().name
                    Regex("^lib/([^/]+)/[^/]+\\.so$").matchEntire(name)?.let { abis.add(it.groupValues[1]) }
                }
            }
            val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            val info = context.packageManager.getPackageArchiveInfo(temporary.path, flags)
                ?: error("Android could not read this APK. It may be incomplete, split-only, or damaged.")
            val app = info.applicationInfo ?: error("The APK has no application metadata.")
            require(info.splitNames.isNullOrEmpty()) { "Import a complete base APK; split-package installation is not implemented yet." }
            app.sourceDir = temporary.path; app.publicSourceDir = temporary.path
            val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
            require(!signatures.isNullOrEmpty()) { "The APK has no readable signing certificate." }
            val id = digest.digest().hex()
            val game = LocalGame(id, app.loadLabel(context.packageManager).toString().take(80).ifBlank { info.packageName }, count,
                info.packageName, info.versionName ?: "Unknown", if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong(),
                app.minSdkVersion, app.targetSdkVersion, abis.toList(), signatures.map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).hex() })
            val destination = file(game)
            if (!destination.exists()) require(temporary.renameTo(destination)) { "Could not save the imported APK." }
            game
        } finally { temporary.delete() }
    }
    companion object { const val MAX_BYTES = 512L * 1024 * 1024 }
}
