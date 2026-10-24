package app.pogo.patches.pokemongo

import app.morphe.patcher.patch.ApkFileType
import app.morphe.patcher.patch.AppTarget
import app.morphe.patcher.patch.Compatibility

/** The agent's offsets are pinned to this exact build; do not add other versions without new offsets. */
val COMPATIBILITY_POKEMON_GO = Compatibility(
    packageName = "com.nianticlabs.pokemongo",
    name = "Pokémon GO",
    apkFileType = ApkFileType.APKM,
    appIconColor = 0xEE1515,
    targets = listOf(
        AppTarget(version = "0.433.1"),
    ),
)
