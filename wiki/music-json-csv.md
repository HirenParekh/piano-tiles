# music_json.csv

This document describes the structure and contents of the `music_json.csv` file, which defines information about songs in Piano Tiles 2.

By understanding the structure and meaning of each field in `music_json.csv`, you can gain valuable insights into the organization and properties of songs within Piano Tiles 2.

### File Structure

The CSV file is organized with each line representing a different song or level part. Each line contains several fields separated by commas.

## Field Descriptions

Here's a breakdown of each field in the CSV file:

-   **Id:** This field determines the song's order on the song selection screen; it also defines the separate parts of a level. These parts correspond to the `id` values within the `musics` array in the song's JSON file. For example, `101` represents `id: 1`, `102` represents `id: 2`, and so on.
-   **Mid:** This field contains a unique identifier for the music.
-   **BPM:** Beats per minute for the song per difficulty level (pipe-separated, e.g. `85|90|94`). Used for audio/MIDI timing. **Does NOT control tile fall speed.**
-   **BaseBeat:** Base beat value per difficulty (e.g. `0.5|0.5|0.5`). Used alongside BPM for note duration calculation. **Does NOT control tile fall speed.**
-   **Ratio:** Effective BPM = BPM / BaseBeat, per difficulty (e.g. `170|180|188`). Used for difficulty categorization/UI display. **Does NOT control tile fall speed.**
-   **MusicJson:** Filename of the corresponding JSON file for the song, located at `/assets/res/song/{title}.json` in the APK.
-   **Musician:** The musician or composer of the song.
-   **Acceleration:** Acceleration value for the song in the game's "Arena" mode.
-   **AniID:** Index of the special effect used for the song.
-   **BridgeAniID:** Index of the transition special effect used for the song.
-   **Musiclevel:** Difficulty level index, derived as `(Ratio - 60) / 40`. Maps to a row in `pianist_difficulty.csv`.
-   **RewardID:** Reward identifier for completing the song.
-   **MusicCard:** Card identifier for the song header image.
-   **Playmark:** Tile type marker used in gameplay.
-   **Fallingrate:** Speed reduction percentage applied only to the **trial/preview segment** of the song. `0` means no slowdown during preview.
-   **ProduceId:** Product/store item identifier.
-   **MusicSpeed** ⭐ **This is the actual tile fall speed multiplier.** A float value where `1.0` = normal speed, `0.5` = half speed, `2.0` = double speed. When absent or empty, defaults to `1.0`. This field was discovered by reverse-engineering `libcocos2dcpp.so` — it does not appear in the original CSV and must be added manually as the last column.

> **Important:** `BPM`, `BaseBeat`, and `Ratio` do **not** affect tile fall speed. Only `MusicSpeed` does.
> The `bpm`/`baseBpm` fields in the per-song JSON files (e.g. `Little Star.json`) also do **not** affect tile fall speed.
> The game reads `res/DB/music_json.csv` directly from the APK. The `embededRemoteAsset/Classic-Local.zip` and `Modern-Local.zip` are **not** used for speed.

## Usage

The information in `music_json.csv` is used by Piano Tiles 2 to define and manage the various songs and levels within the game. The game reads this file directly from `res/DB/music_json.csv` at startup (confirmed via `CCFileUtils-android.cpp` logcat).

To modify tile fall speed for any song, add a `MusicSpeed` column as the last column and set a float multiplier value. All rows must be padded to 16 columns before appending `MusicSpeed` to ensure correct positional parsing.
