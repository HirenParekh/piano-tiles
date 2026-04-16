import json
import re

# PT2 Notation Mapping
VAL_MAP = {
    'H': 8, 'I': 4, 'J': 2, 'K': 1, 'L': 0.5, 'M': 0.25, 'N': 0.125, 'O': 0.0625, 'P': 0.03125,
    'Q': 8, 'R': 4, 'S': 2, 'T': 1, 'U': 0.5, 'V': 0.25, 'W': 0.125, 'X': 0.0625, 'Y': 0.03125
}

def calculate_duration(bracket_str):
    total = 0
    for char in bracket_str:
        total += VAL_MAP.get(char, 0)
    return total

def parse_pt2_string(s):
    # Regex to find tokens:
    # 1. Note with brackets: (notes)[brackets] or note[brackets]
    # 2. Standalone rest characters: Q, R, S, T, U, V, W, X, Y
    # 3. Double groups: 5< tokens >
    
    tokens = []
    # Simplified parser: 
    # Use split by comma but be careful with commas inside (note.note)
    
    # Actually, midi2json strings use commas between elements unless it's a double group.
    # Let's split by comma and process each segment.
    raw_segments = s.split(',')
    
    for seg in raw_segments:
        if not seg: continue
        
        # Check if it's a note with brackets [...]
        if '[' in seg and ']' in seg:
            brackets = seg.split('[')[1].split(']')[0]
            dur = calculate_duration(brackets)
            tokens.append({'raw': seg, 'duration': dur})
        else:
            # It's a rest or sequence of rest characters
            # e.g. "QRTUV"
            dur = 0
            for char in seg:
                dur += VAL_MAP.get(char, 0)
            tokens.append({'raw': seg, 'duration': dur})
            
    return tokens

def inject_measures(tokens, beats_per_measure=4):
    measures = []
    current_measure = []
    current_beats = 0
    
    for t in tokens:
        current_measure.append(t['raw'])
        current_beats += t['duration']
        
        # If we reach or exceed the measure boundary
        if current_beats >= beats_per_measure - 0.01:
            measures.append(",".join(current_measure))
            current_measure = []
            current_beats = 0
            
    if current_measure:
        measures.append(",".join(current_measure))
        
    return ";".join(measures)

def split_measures(measures_str, num_parts=3):
    measures = measures_str.split(';')
    n = len(measures)
    part_size = n // num_parts
    
    parts = []
    for i in range(num_parts):
        start = i * part_size
        end = (i + 1) * part_size if i < num_parts - 1 else n
        parts.append(";".join(measures[start:end]))
        
    return parts

def process_midi_text(file_path):
    with open(file_path, 'r') as f:
        content = f.read()
        
    # Extract tracks
    track1_raw = content.split('Track 1')[1].split('Track 2')[0].strip()
    track2_raw = content.split('Track 2')[1].split('Warnings')[0].strip()
    
    # Track 1
    t1_tokens = parse_pt2_string(track1_raw)
    t1_full = inject_measures(t1_tokens)
    t1_parts = split_measures(t1_full, 3)
    
    # Track 2
    t2_tokens = parse_pt2_string(track2_raw)
    t2_full = inject_measures(t2_tokens)
    t2_parts = split_measures(t2_full, 3)
    
    musics = []
    for i in range(3):
        musics.append({
            "id": i + 1,
            "bpm": 68,
            "baseBeats": 0.5,
            "scores": [t1_parts[i], t2_parts[i]]
        })
        
    song_json = {
        "baseBpm": 68,
        "musics": musics
    }
    
    return song_json

if __name__ == "__main__":
    input_file = r'c:\Users\parek\Projects\piano-tiles\recordings\Sheets\midi_text.txt'
    output_file = r'c:\Users\parek\Projects\piano-tiles\public\songs\Tum Hi Ho.json'
    
    result = process_midi_text(input_file)
    with open(output_file, 'w') as f:
        json.dump(result, f, indent=2)
        
    print(f"Generated 3-part song to: {output_file}")
