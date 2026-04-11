import glob
from PIL import Image
frames=sorted(glob.glob('recordings/frames/*.jpg'))
for f in frames[5:15]:
    img=Image.open(f).convert('L')
    w,h=img.size
    max_x,max_y,min_x,min_y = 0,0,w,h
    
    # Just find the pixels > 240
    pixels = img.load()
    for y in range(h):
        for x in range(w):
            if pixels[x,y] > 240:
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
    
    print(f.split('-')[-1], max_x-min_x, max_y-min_y)
