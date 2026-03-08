# Piano Tiles 2: Reverse Engineering & ADB Experiment Log

## 1. The Strategy: Live APK Modification & ADB Testing
To perfectly understand the original engine's behavior, we established a pipeline to modify the authentic game, repackage it, and run it on a physical Android device.

**The Workflow:**
1. **Unpacking:** We extracted the original `Piano Tiles 2` `.xapk` (an Android App Bundle) into its separate base and configuration APK splits.
2. **Consolidation:** We merged the split components into a single customizable directory (`PianoTilesMod`).
3. **Modification:** We directly edited the game's internal data (specifically JSON files located in `assets/res/song/`).
4. **Repacking:** We used a custom Python script (`build_apk.py`) to rebuild a universal APK, ensuring `STORED` compression for libraries/assets to comply with Android 11+ requirements.
5. **Signing & Installation:** We signed the APK using `uber-apk-signer.jar` (with a debug keystore) and installed it directly to a physical Android device via USB using `adb install -r`.

This live-testing feedback loop allowed us to bypass decompiled C++ code and observe exactly how the closed-source engine reacts to specific data inputs.

---

## 2. The Anomaly: The Silent `e1[L]` Note
**The Problem:** While playing the song *Jingle Bells*, we noticed a discrepancy between our web engine and the original game. In the original APK, during the second long melody tile (`e3[K]`), the bass track dictates an accompaniment note `e1[L]` should play precisely halfway through the hold. 
**Observation:** In the original game, this `e1[L]` note is completely invisible (no accompaniment dot on the long tile) and entirely silent. Our web engine, however, rendered and played it.

See the screenshot of the original game: public\recordings\3.jpg

---

## 3. The Experiments & Findings
To understand *why* the original engine hid this specific note, we used our ADB modding pipeline to run tests directly on the Android device by editing `Jingle Bells.json`.

### Experiment A: Temporal Shifting (Rests)
* **Action:** We added new note next to `e1[L]` accompaniment note with a silent rest (`V` or `U`) of a different duration.
* **Result:** This change misaligned the time grid of the bass track. Because the subsequent notes were pushed outside the exact active window of the `e3[K]` long tile, they suddenly began rendering dots and playing audio. 
* **Takeaway:** The engine suppression is strictly tied to the temporal overlap window of the long tile.
See the screenshot of the original game: public\recordings\1.jpg

### Experiment B: Pitch Change
* **Action:** We kept the timing identical but replaced the `e1[L]` note with `#c1[L]` (changing the note from E to C-sharp).
* **Result:** The game rendered a visible dot halfway up the `e3[K]` long tile, and the `#c1` note played audibly. 
* **Takeaway:** The suppression is explicitly dependent on the specific note being played, not just the fact that it happens concurrently.
See the screenshot of the original game: public\recordings\2.jpg

