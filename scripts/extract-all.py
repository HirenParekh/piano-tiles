import plistlib
import re
import os
from PIL import Image

def parse_string(s):
    # parses "{{x,y},{w,h}}" to [x, y, w, h]
    numbers = re.findall(r'-?\d+', s)
    return [int(n) for n in numbers]

def extract_all_sprites(plist_path, png_path, output_dir):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    with open(plist_path, 'rb') as f:
        plist = plistlib.load(f)

    img = Image.open(png_path)
    frames = plist['frames']

    for target_key, frame_data in frames.items():
        # frame is "{{x,y},{w,h}}" or rotated equivalent
        rect = parse_string(frame_data['frame'])
        rotated = frame_data['rotated']
        
        if rotated:
            # If rotated, the w and h in frame are usually actually h and w
            crop_box = (rect[0], rect[1], rect[0] + rect[3], rect[1] + rect[2])
        else:
            crop_box = (rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3])
            
        cropped = img.crop(crop_box)
        
        if rotated:
            # Rotate 90 CCW to get back to original
            cropped = cropped.rotate(90, expand=True)

        out_path = os.path.join(output_dir, target_key)
        cropped.save(out_path)
        print(f"Extracted {target_key}")

os.chdir(r"c:\Users\parek\Projects\piano-tiles")

print("Extracting ALL from 1.plist...")
extract_all_sprites(
    "PianoTilesJAVA/resources/assets/res/gameImage/1.plist",
    "PianoTilesJAVA/resources/assets/res/gameImage/1.png",
    "public/assets/atlas_1"
)
print("Done!")
