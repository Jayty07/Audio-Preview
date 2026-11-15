# File Picker Audio Preview

A Foundry VTT module that lets you **listen to audio files while browsing in the file picker**. Every audio file in the browser gets a ▶ play / ■ stop button, so you can hear a track before you choose it for a playlist, ambient sound, or anything else.

- Works with **Foundry VTT v12 and v13**
- Works on **The Forge**: Assets Library, Bazaar content, and core/user data folders, as well as S3 and self-hosted servers
- Works in all four file picker views: list, thumbnails, tiles, and images
- Shows a progress bar you can click to jump to any point, plus elapsed / total time
- Plays only in your own browser. Nothing is broadcast to your players.
- One preview plays at a time. It stops when you play another file, open a different folder, or close the file picker.

## Install on The Forge

1. On forge-vtt.com, open **The Bazaar** and choose **Install From Manifest** in the left sidebar.
2. Paste this manifest URL:

   ```
   https://raw.githubusercontent.com/Jayty07/Audio-Preview/main/module.json
   ```

3. Turn **off** "Install from the Bazaar if the package is found", then install.
4. Launch your world, then go to **Game Settings → Manage Modules**, tick **File Picker Audio Preview**, and save.

**Alternative: upload the zip yourself.** On the Forge's Game Configuration page, choose **Summon Import Wizard**. Turn off "Install found packages from the Bazaar", select `module.zip` as a ZIP file, and click **Analyze**. Then restart your server and enable the module in your world.

## Install on a self-hosted Foundry

Go to **Add-on Modules → Install Module**, paste the manifest URL above, and click **Install**. Then enable the module in your world.

## Settings

Find these under **Game Settings → Configure Settings → File Picker Audio Preview**. Each user sets their own.

| Setting | Default | What it does |
| --- | --- | --- |
| Preview volume | 50% | How loud previews play on this computer. |
| Scale by Interface volume | Off | Also multiplies the preview volume by Foundry's Interface volume slider. |
| Preview when selecting a file | Off | Clicking an audio file to select it also starts its preview. |
| Loop previews | Off | Repeats the preview until you stop it. |

## Notes

- **MIDI (`.mid`) files** are marked as unplayable, because browsers can't play MIDI natively.
- **`.webm`** files only get a play button when the file picker is filtered to audio, such as when choosing a playlist sound. Elsewhere Foundry treats `.webm` as video.
- If a file fails to load (missing, blocked, or in a format the browser can't play), you'll see a warning and the button resets.

## Publishing a new version (repository owner)

The manifest and download links point straight at `module.json` and `module.zip` on the `main` branch, so no GitHub release is needed.

1. Make your changes, then raise `version` in `module.json` (for example to `1.0.1`).
2. Rebuild `module.zip` from `module.json`, `README.md`, `scripts/`, `styles/` and `lang/`, so that `module.json` sits at the top level of the zip.
3. Commit both files to `main`. The Forge and Foundry will offer the update the next time they check for updates. GitHub caches these files for about 5 minutes.
