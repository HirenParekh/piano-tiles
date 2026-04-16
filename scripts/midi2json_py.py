import json
import argparse
from mido import MidiFile

def check_n(midi):
    # Replicates Checkn from main.cpp
    note_names = ['c', '#c', 'd', '#d', 'e', 'f', '#f', 'g', '#g', 'a', '#a', 'b']
    octave = (midi // 12) - 4
    name = note_names[midi % 12]
    if octave == 0: return name
    return f"{name}{octave}"

def check_d(t, mode, x):
    # Replicates Checkd from main.cpp logic
    # x is the ticks for a quarter note (usually TPB)
    table = {
        8.0: ('H', 'Q'),
        4.0: ('I', 'R'),
        2.0: ('J', 'S'),
        1.0: ('K', 'T'),
        0.5: ('L', 'U'),
        0.25: ('M', 'V'),
        0.125: ('N', 'W'),
        0.0625: ('O', 'X'),
        0.03125: ('P', 'Y')
    }
    beats = t / x
    result = ""
    keys = sorted(table.keys(), reverse=True)
    
    while beats > 0.01:
        found = False
        for k in keys:
            if beats >= k - 0.001:
                char = table[k][mode]
                result += char
                beats -= k
                found = True
                break
        if not found: break
    return result

def convert_midi_to_pt2(input_path):
    mid = MidiFile(input_path)
    output_tracks = []
    
    for i, track in enumerate(mid.tracks):
        has_notes = any(m.type == 'note_on' for m in track)
        if not has_notes: continue

        abs_events = []
        t = 0
        for msg in track:
            t += msg.time
            if msg.type == 'note_on' and msg.velocity > 0:
                abs_events.append({'time': t, 'type': 'on', 'note': msg.note})
            elif (msg.type == 'note_off') or (msg.type == 'note_on' and msg.velocity == 0):
                abs_events.append({'time': t, 'type': 'off', 'note': msg.note})
        
        abs_events.sort(key=lambda x: x['time'])
        
        note_objects = []
        pending_notes = {}
        for ev in abs_events:
            if ev['type'] == 'on':
                pending_notes[ev['note']] = ev['time']
            else:
                if ev['note'] in pending_notes:
                    start = pending_notes.pop(ev['note'])
                    note_objects.append({'note': ev['note'], 'start': start, 'duration': ev['time'] - start})
        
        note_objects.sort(key=lambda x: x['start'])
        
        track_str = ""
        current_cursor = 0
        measure_ticks = 4 * mid.ticks_per_beat
        measure_count = 0
        
        chords = []
        for n in note_objects:
            if not chords or chords[-1][0]['start'] != n['start']:
                chords.append([n])
            else:
                chords[-1].append(n)
        
        for chord in chords:
            start_tick = chord[0]['start']
            duration_tick = chord[0]['duration']
            
            if start_tick > current_cursor:
                rest_ticks = start_tick - current_cursor
                while current_cursor + rest_ticks >= (measure_count + 1) * measure_ticks:
                    to_next_boundary = (measure_count + 1) * measure_ticks - current_cursor
                    track_str += check_d(to_next_boundary, 1, mid.ticks_per_beat) + ";"
                    rest_ticks -= to_next_boundary
                    current_cursor += to_next_boundary
                    measure_count += 1
                if rest_ticks > 0:
                    track_str += check_d(rest_ticks, 1, mid.ticks_per_beat) + ","
                    current_cursor += rest_ticks

            token = ""
            if len(chord) > 1:
                token = "(" + ".".join([check_n(n['note']) for n in chord]) + ")"
            else:
                token = check_n(chord[0]['note'])
            
            token += "[" + check_d(duration_tick, 0, mid.ticks_per_beat) + "]"
            track_str += token + ","
            current_cursor += duration_tick
            
            while current_cursor >= (measure_count + 1) * measure_ticks:
                if track_str.endswith(','): track_str = track_str[:-1]
                track_str += ";"
                measure_count += 1
                
        output_tracks.append(track_str)
        
    return output_tracks

def split_scores(scores, num_parts=3):
    # Split all tracks based on measure boundaries (;)
    # We find the intersection of measure counts to be safe
    all_track_measures = [s.split(';') for s in scores]
    n = len(all_track_measures[0])
    part_size = n // num_parts
    
    parts = []
    for i in range(num_parts):
        start = i * part_size
        end = (i + 1) * part_size if i < num_parts - 1 else n
        part_scores = [";".join(track_m[start:end]) for track_m in all_track_measures]
        parts.append(part_scores)
    return parts

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Convert MIDI to PT2 JSON.")
    parser.add_argument("input", help="Source .mid file")
    parser.add_argument("output", help="Destination JSON file")
    parser.add_argument("--bpm", type=int, default=68, help="BPM (default 68)")
    parser.add_argument("--parts", type=int, default=3, help="Number of music objects (default 3)")
    
    args = parser.parse_args()
    
    full_tracks = convert_midi_to_pt2(args.input)
    track_parts = split_scores(full_tracks, args.parts)
    
    musics = []
    for i, scores in enumerate(track_parts):
        musics.append({
            "id": i + 1,
            "bpm": args.bpm,
            "baseBeats": 0.5,
            "scores": scores
        })
        
    result = {"baseBpm": args.bpm, "musics": musics}
    with open(args.output, 'w') as f:
        json.dump(result, f, indent=2)
    print(f"Successfully converted {args.input} to {args.output} with {args.parts} parts.")
