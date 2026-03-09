# Web Game Architecture: Audio & Graphics Strategy

## 1. Web Audio: Tone.js vs AudioWorklet
Switching to `AudioWorklet` for a rhythm game provides immense low-latency benefits, but it fundamentally changes the architecture of your app.

### Do we still need Tone.js?
**Probably Not (for playback).** If we move to a raw `AudioWorklet` implementation, the fundamental goal is to bypass the main JS thread for audio triggering. 
* Right now, `Tone.js` abstracts `AudioBufferSourceNode`. When you tap a tile, `Tone.Sampler` parses it and plays it.
* If we use `AudioWorklet`, we would write a custom Javascript file (`processor.js`) that runs on the audio thread. We load all the `.mp3` bytes directly into this thread. When you tap a tile, React simply sends a tiny, highly efficient postMessage: `port.postMessage({ note: 'c4', time: ... })`, and the Worklet parses the raw buffer arrays to emit the sound instantly. 
* *Note:* You *can* technically use `Tone.js` alongside an AudioWorklet (Tone actually uses them under the hood for some nodes), but for building a raw, lowest-latency custom sample trigger module, writing the pure Worklet node is the most performant route.

### The Trade-off
Building an `AudioWorklet` sample player from scratch means we have to manually write the logic to decode MP3 arrays, manage ADSR (Attack, Decay, Sustain, Release) envelopes, and apply Reverb math (which `Tone.js` currently does for us in 3 lines of code).

---

## 2. Web Graphics: OpenGL vs WebGL
You asked if we should use **OpenGL** for developing this game. The short answer is: **You cannot use raw OpenGL in a web browser.**

### The Web Graphics standard is WebGL
* **OpenGL** is a massive, low-level graphics API designed for native desktop apps, consoles, and operating systems (written in C/C++).
* **WebGL** is a JavaScript API based on a stripped-down version of OpenGL (specifically OpenGL ES) that browsers use to hardware-accelerate 2D and 3D graphics inside the `<canvas>`.
* Therefore, to build a high-performance web rhythm game, **we would use WebGL.**

### Should we switch to WebGL?
Currently, our Piano Tiles game's `GameBoard.tsx` is built using standard React/HTML DOM elements (using `<div>`s that are absolutely positioned and moved around).
For a simple grid game, the browser's DOM compositor is usually fast enough. However, manipulating thousands of DOM nodes causes heavy layout thrashing, which leads to visual stutter (frame drops).

If we want the game to look and feel like an authentic mobile App Store game (with 120 FPS buttery smooth scrolling, particle effects, glow shaders, and physics animations without any jitter), **migrating the board to WebGL** is the industry standard.

### How to use WebGL
Nobody writes raw WebGL math by hand anymore because it requires thousands of lines of complex matrix algebra. Instead, we would use a popular 2D/3D WebGL framework:
1. **Pixi.js:** The absolute gold standard for 2D WebGL rhythm games. It replaces the HTML DOM with a single Canvas and renders sprites infinitely faster than React can render `div`s.
2. **Three.js:** The standard for 3D web games, if you wanted 3D falling tiles.
