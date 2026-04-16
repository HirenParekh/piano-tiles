import json
import argparse
from mido import MidiFile, MidiTrack, Message, MetaMessage

def generate_midi(input_path, output_path, bpm=120, tpb=480, quantize=0):
    """
    Converts note objects from JSON into a Standard MIDI File (.mid).
    
    Arguments:
    - input_path: Path to the JSON file with note objects.
    - output_path: Path to save the generated MIDI file.
    - bpm: Beats Per Minute (default 120 for mapping).
    - tpb: Ticks Per Beat (default 480).
    - quantize: Resolution denominator (e.g., 16 for 1/16th notes). 0 to disable.
    """
    with open(input_path, 'r') as f:
        notes_data = json.load(f)

    mid = MidiFile(ticks_per_beat=tpb)
    
    # Standard conversion formula: ticks = seconds * (bpm / 60) * tpb
    def sec_to_ticks(sec):
        t = int(sec * (bpm / 60) * tpb)
        if quantize > 0:
            # Grid = (TPB * 4) / quantize
            grid = (tpb * 4) // quantize
            t = round(t / grid) * grid
        return t

    def quantize_duration(dur_sec, start_ticks):
        d = int(dur_sec * (bpm / 60) * tpb)
        if quantize > 0:
            grid = (tpb * 4) // quantize
            # End time must be grid-aligned
            end_ticks = round((start_ticks + d) / grid) * grid
            d = max(grid, end_ticks - start_ticks)
        return d

    # Group notes by trackIndex
    tracks = {}
    for note_obj in notes_data:
        tr_idx = note_obj.get('trackIndex', 0)
        if tr_idx not in tracks:
            tracks[tr_idx] = []
        tracks[tr_idx].append(note_obj)

    # Process each track
    for tr_idx in sorted(tracks.keys()):
        track = MidiTrack()
        mid.tracks.append(track)
        
        name = "Melody" if tr_idx == 0 else "Bass"
        track.append(MetaMessage('track_name', name=name, time=0))
        
        if tr_idx == 0:
            track.append(MetaMessage('set_tempo', tempo=int(60000000 / bpm), time=0))

        events = []
        for note in tracks[tr_idx]:
            pitch = note['note']
            velocity = note['velocity']
            start_ticks = sec_to_ticks(note['time'])
            duration_ticks = quantize_duration(note['duration'], start_ticks)
            
            events.append({
                'time': start_ticks,
                'type': 'note_on',
                'note': pitch,
                'velocity': velocity
            })
            events.append({
                'time': start_ticks + duration_ticks,
                'type': 'note_off',
                'note': pitch,
                'velocity': 0
            })

        # Sort events by absolute tick time (ensure Note Off comes before Note On at same tick)
        events.sort(key=lambda x: (x['time'], 0 if x['type'] == 'note_off' else 1))

        last_ticks = 0
        for ev in events:
            delta = ev['time'] - last_ticks
            track.append(Message(ev['type'], note=ev['note'], velocity=ev['velocity'], time=delta))
            last_ticks = ev['time']

    mid.save(output_path)
    status = f" (Quantized to 1/{quantize})" if quantize > 0 else " (Human Timing)"
    print(f"MIDI file generated: {output_path}{status}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert Note JSON to MIDI with optional quantization.")
    parser.add_argument("input", help="Source JSON file")
    parser.add_argument("output", help="Destination .mid file")
    parser.add_argument("--quantize", type=int, default=0, help="Quantization resolution (e.g., 16 for 1/16th notes). 0 = Off.")
    parser.add_argument("--bpm", type=int, default=120, help="BPM used for scaling (default 120)")
    
    args = parser.parse_args()
    generate_midi(args.input, args.output, bpm=args.bpm, quantize=args.quantize)
