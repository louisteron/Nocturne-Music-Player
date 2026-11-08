"""Génère l'icône géométrique de Nocturne, sans ressource distante."""
from pathlib import Path
from PIL import Image, ImageDraw
import colorsys
import math

size = 1024
image = Image.new('RGBA', (size, size))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 1023, 1023), radius=220, fill='#0c1b1d')
cx, cy, radius = 512, 495, 345
for angle in range(720):
    rgb = colorsys.hsv_to_rgb(angle / 720, .24, .79)
    color = tuple(round(c * 255) for c in rgb)
    draw.pieslice((cx-radius, cy-radius, cx+radius, cy+radius), angle / 2, angle / 2 + 1, fill=color)
for r in range(85, radius, 8):
    draw.ellipse((cx-r, cy-r, cx+r, cy+r), outline=(28, 65, 64, 65), width=2)
draw.ellipse((cx-51, cy-51, cx+51, cy+51), fill='#0c1b1d', outline='#d6e3cf', width=9)
draw.line([(590, 635), (590, 314), (727, 282), (727, 603)], fill='#153f3e', width=22)
draw.line([(590, 352), (727, 320)], fill='#153f3e', width=22)
draw.ellipse((526, 605, 603, 657), fill='#153f3e')
draw.ellipse((663, 573, 740, 625), fill='#153f3e')
Path('build').mkdir(exist_ok=True)
image.save('build/icon.png')
