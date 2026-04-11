from PIL import Image
import sys

img = Image.open('public/assets/hold-tiles/hold_dome.png')
pixels = img.load()
width, height = img.size

# Find the first row from the top with non-zero alpha
first_y = None
for y in range(height):
    for x in range(width):
        if pixels[x, y][3] > 0:
            first_y = y
            break
    if first_y is not None:
        break

# Find the highest alpha row
max_alpha = 0
max_y = 0
for y in range(height):
    row_alpha = sum(pixels[x, y][3] for x in range(width))
    if row_alpha > max_alpha:
        max_alpha = row_alpha
        max_y = y

last_y = None
for y in range(height-1, -1, -1):
    for x in range(width):
        if pixels[x, y][3] > 0:
            last_y = y
            break
    if last_y is not None:
        break


print(f"Size: {width}x{height}")
print(f"First visible pixel from top: y={first_y}")
print(f"Row with highest total alpha: y={max_y}")
print(f"Last visible pixel from top: y={last_y}")
