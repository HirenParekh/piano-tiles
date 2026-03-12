# 🎹 Piano Tiles Web

A modern, web-based clone of the popular Piano Tiles game, built with React, Vite, TypeScript, and Tone.js. This project aims to bring the engaging rhythm-based gameplay to the browser with smooth performance, customizable songs, and dynamic midi/JSON beat-map parsing.

## ✨ Features

- **Slot-Based Dynamic Game Board**: Rendering tiles in precise slots corresponding to the rhythm, keeping you perfectly in tune with the music.
- **Multiple Game Modes**: Simple tap tiles and long-hold tiles supported!
- **Tone.js Audio Synthesis**: High-quality in-browser MIDI playback using Tone.js synthesizers.
- **Beat-Map Parsers**: Robust parsing of custom JSON structures mimicking the original mobile game beats and standard MIDI files.
- **Smooth Animations**: Hardware-accelerated CSS integrations and Grid-based layouts to ensure high FPS on all devices.
- **Large Song Catalog**: Includes a growing catalog of playable songs.

## 🚀 Tech Stack

- **[React 18](https://reactjs.org/)** — UI Component Library
- **[Vite](https://vitejs.dev/)** — Next Generation Frontend Tooling
- **[TypeScript](https://www.typescriptlang.org/)** — Type-Safe JavaScript
- **[Tone.js](https://tonejs.github.io/)** — Interactive Web Audio synthesis & MIDI manipulation
- **[Sass](https://sass-lang.com/)** — CSS Pre-processor for advanced styling

## 🛠️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/HirenParekh/piano-tiles.git
   cd piano-tiles
   ```

2. **Install dependencies:**
   Make sure you have [Node.js](https://nodejs.org/) installed, then run:
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   Your app will be running at `http://localhost:5173/`

## 🕹️ How to Play

1. Choose a song from the main library menu.
2. Once the game starts, black tiles will scroll downwards.
3. Tap or click on the black tiles before they hit the bottom of the screen to score points and play the corresponding notes.
4. For long tiles, click and hold!
5. Miss a tile or click an empty space? Game over!

## 🧪 Testing

This project uses [Vitest](https://vitest.dev/) for fast unit testing.
To run the test suite:

```bash
npm run test
```

## 📝 License

This project is intended for educational and portfolio purposes.
