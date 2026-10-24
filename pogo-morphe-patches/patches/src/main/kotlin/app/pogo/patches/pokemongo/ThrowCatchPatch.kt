package app.pogo.patches.pokemongo

import app.morphe.patcher.patch.bytecodePatch
import app.morphe.patcher.patch.resourcePatch
import org.w3c.dom.Element

private object Payload

private const val PROVIDER_CLASS = "app.pogo.extension.BootstrapProvider"
private val PAYLOAD_FILES = listOf("libfrida-gadget.so", "throw-catch-agent.js")

/**
 * Ships the gadget + agent as assets and registers a ContentProvider that loads them before
 * Application.onCreate (providers initialise first). No smali hooks, no fingerprints.
 */
private val pogoPayloadPatch = resourcePatch {
    execute {
        for (name in PAYLOAD_FILES) {
            val input = Payload::class.java.getResourceAsStream("/pogo/$name")
                ?: error("Bundled resource /pogo/$name is missing; run the preparePayload gradle task")
            val target = get("assets/pogo/$name")
            target.parentFile.mkdirs()
            input.use { i -> target.outputStream().use { o -> i.copyTo(o) } }
        }

        document("AndroidManifest.xml").use { document ->
            val manifest = document.documentElement
            val application = document.getElementsByTagName("application").item(0) as Element
            val provider = document.createElement("provider").apply {
                setAttribute("android:name", PROVIDER_CLASS)
                setAttribute("android:authorities", manifest.getAttribute("package") + ".pogo.bootstrap")
                setAttribute("android:exported", "false")
                setAttribute("android:initOrder", Int.MAX_VALUE.toString())
            }
            application.appendChild(provider)
        }
    }
}

@Suppress("unused")
val enhancedThrowQuickCatchPatch = bytecodePatch(
    name = "Enhanced throw and quick catch",
    description = "Forces Excellent curveball throws and speeds up the catch animation.",
    default = true,
) {
    compatibleWith(COMPATIBILITY_POKEMON_GO)
    dependsOn(pogoPayloadPatch)

    // Extension dex containing BootstrapProvider. Must match the artifact name the template's
    // extensions/extension module produces.
    extendWith("extensions/extension.mpe")

    execute {
        // Nothing to rewrite in bytecode: the native hooks are installed by the bundled agent.
    }
}
