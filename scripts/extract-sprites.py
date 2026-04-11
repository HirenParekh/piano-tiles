import plistlib
import re
import os
from PIL import Image

def parse_string(s):
    # parses "{{x,y},{w,h}}" to [x, y, w, h]
    numbers = re.findall(r'-?\d+', s)
    return [int(n) for n in numbers]

def extract_sprites(plist_path, png_path, output_dir, target_keys):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    with open(plist_path, 'rb') as f:
        plist = plistlib.load(f)

    img = Image.open(png_path)
    frames = plist['frames']

    for target_key, out_name in target_keys.items():
        if target_key in frames:
            frame_data = frames[target_key]
            
            # frame is "{{x,y},{w,h}}" or rotated equivalent
            rect = parse_string(frame_data['frame'])
            rotated = frame_data['rotated']
            source_size = parse_string(frame_data['sourceSize'])
            
            if rotated:
                # If rotated, the w and h in frame are usually actually h and w
                crop_box = (rect[0], rect[1], rect[0] + rect[3], rect[1] + rect[2])
            else:
                crop_box = (rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3])
                
            cropped = img.crop(crop_box)
            
            if rotated:
                # Rotate 90 CCW to get back to original
                cropped = cropped.rotate(90, expand=True)

            out_path = os.path.join(output_dir, out_name)
            cropped.save(out_path)
            print(f"Extracted {target_key} -> {out_name}")
        else:
            print(f"Warning: {target_key} not found in {plist_path}")


os.chdir(r"c:\Users\parek\Projects\piano-tiles")

# Setup targets for 1.plist
targets_1 = {
    "long_head.png": "hold_head.png",
    "long_tap2.png": "hold_body.png",
    "long_light.png": "hold_dome.png",
    "long_tilelight.png": "hold_fill.png",
    "long_finish.png": "hold_finish.png",
    "dot.png": "hold_dot.png",
    "dot_light.png": "hold_dot_glow.png"
}

# Setup targets for Plist_2.plist
targets_2 = {
    "long_tap2_faded.png": "hold_body_faded.png"
}

print("Extracting from 1.plist...")
extract_sprites(
    "PianoTilesJAVA/resources/assets/res/gameImage/1.plist",
    "PianoTilesJAVA/resources/assets/res/gameImage/1.png",
    "public/assets/hold-tiles",
    targets_1
)

print("Extracting from Plist_2.plist...")
extract_sprites(
    "PianoTilesJAVA/resources/assets/res/gameImage/Plist_2.plist",
    "PianoTilesJAVA/resources/assets/res/gameImage/Plist_2.png",
    "public/assets/hold-tiles",
    targets_2
)

# Copy standalone glow
glow_src = "PianoTilesJAVA/resources/assets/res/gameImage/glow.png"
glow_dst = "public/assets/hold-tiles/hold_glow.png"
if os.path.exists(glow_src):
    Image.open(glow_src).save(glow_dst)
    print("Copied glow.png -> hold_glow.png")
