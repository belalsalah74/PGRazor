// Applied from the template's patches/build.gradle.kts with:  apply(from = "payload.gradle.kts")
// Bundles the Frida gadget (downloaded + SHA-256 verified at build time) and the agent script
// into the patches jar as resources under /pogo/.
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest

val fridaVersion = "17.24.2"
val payloadDir = layout.buildDirectory.dir("generated/pogo-resources")
val agentScript = rootProject.file("agent/throw-catch-agent.js")

val preparePayload = tasks.register("preparePayload") {
    description = "Download + verify the Frida gadget and stage it with the agent script."
    val out = payloadDir.get().dir("pogo").asFile
    inputs.property("fridaVersion", fridaVersion)
    inputs.file(agentScript)
    outputs.dir(out)

    doLast {
        fun open(url: String): HttpURLConnection {
            val c = URI(url).toURL().openConnection() as HttpURLConnection
            c.instanceFollowRedirects = true
            c.setRequestProperty("User-Agent", "pogo-morphe-patches-build")
            System.getenv("GITHUB_TOKEN")?.let { c.setRequestProperty("Authorization", "Bearer $it") }
            if (c.responseCode != 200) error("HTTP ${c.responseCode} for $url")
            return c
        }

        out.deleteRecursively()
        out.mkdirs()

        val asset = "frida-gadget-$fridaVersion-android-arm64.so.xz"
        val release = open("https://api.github.com/repos/frida/frida/releases/tags/$fridaVersion")
            .inputStream.bufferedReader().use { it.readText() }
        @Suppress("UNCHECKED_CAST")
        val assets = (groovy.json.JsonSlurper().parseText(release) as Map<String, Any?>)["assets"] as List<Map<String, Any?>>
        val digest = assets.firstOrNull { it["name"] == asset }?.get("digest") as? String
            ?: error("GitHub did not publish a digest for $asset; refusing to bundle an unverified binary")
        val expected = digest.removePrefix("sha256:").lowercase()

        val xz = File(temporaryDir, asset)
        open("https://github.com/frida/frida/releases/download/$fridaVersion/$asset").inputStream.use { i ->
            xz.outputStream().use { o -> i.copyTo(o) }
        }
        val actual = MessageDigest.getInstance("SHA-256").digest(xz.readBytes()).joinToString("") { "%02x".format(it) }
        check(actual == expected) { "Gadget SHA-256 mismatch: expected $expected, got $actual" }

        val so = File(out, "libfrida-gadget.so")
        val proc = ProcessBuilder("xz", "-dc", xz.absolutePath).redirectOutput(so).redirectError(ProcessBuilder.Redirect.INHERIT).start()
        check(proc.waitFor() == 0) { "xz failed; is xz installed?" }
        val head = so.inputStream().use { it.readNBytes(20) }
        // ELF magic, 64-bit, little-endian, e_machine == EM_AARCH64 (0xB7)
        check(head[0] == 0x7f.toByte() && head[1] == 'E'.code.toByte() && head[4] == 2.toByte() &&
            head[5] == 1.toByte() && head[18] == 0xB7.toByte() && head[19] == 0.toByte()) { "Gadget is not an arm64 ELF" }

        agentScript.copyTo(File(out, "throw-catch-agent.js"), overwrite = true)
    }
}

extensions.getByType(org.gradle.api.tasks.SourceSetContainer::class.java)
    .getByName("main").resources.srcDir(payloadDir)
tasks.named("processResources") { dependsOn(preparePayload) }
