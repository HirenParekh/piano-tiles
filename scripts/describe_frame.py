from PIL import Image

def show_ascii(path):
    print(path)
    img = Image.open(path).convert('L')
    
    # Try multiple coordinates if center isn't bright
    # In piano tiles, the beat dot is on a tile lane.
    w, h = img.size
    # let's just resize the whole image to 80x40 and show the brightest spots
    img = img.resize((80, 40))
    pixels = img.load()
    ascii_chars = ' `.-:\'=+*#%@'
    
    res = ''
    for y in range(40):
        for x in range(80):
            val = pixels[x, y]
            # enhance contrast
            if val < 100: val = 0
            idx = int((val/255) * (len(ascii_chars)-1))
            res += ascii_chars[idx]
        res += '\n'
    print(res)

show_ascii('recordings/frames/vlcsnap-2026-03-29-11h46m33s250.jpg') # pre-burst
show_ascii('recordings/frames/vlcsnap-2026-03-29-11h46m39s627.jpg') # burst peak
show_ascii('recordings/frames/vlcsnap-2026-03-29-11h46m43s703.jpg') # fade
