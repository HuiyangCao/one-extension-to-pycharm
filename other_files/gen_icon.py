from PIL import Image, ImageDraw, ImageFont

SIZE = 128
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# File fills entire icon
fx, fy, fw, fh = 8, 4, 112, 120
fold = 28

d.polygon([
    (fx, fy),
    (fx + fw - fold, fy),
    (fx + fw, fy + fold),
    (fx + fw, fy + fh),
    (fx, fy + fh),
], fill=(200, 210, 230, 255))
d.polygon([
    (fx + fw - fold, fy),
    (fx + fw, fy + fold),
    (fx + fw - fold, fy + fold),
], fill=(120, 140, 170, 255))

# Text lines
line_ys = [fy + 44, fy + 60, fy + 76, fy + 92]
line_ws = [fw - 16, fw - 50, fw - 16, fw - 40]
for ly, lw in zip(line_ys, line_ws):
    d.rectangle([fx + 12, ly, fx + lw, ly + 8], fill=(100, 120, 150, 255))

# Yellow highlight on second line
hl_y = line_ys[1]
hl_x2 = fx + line_ws[1]
d.rectangle([fx + 12, hl_y, hl_x2, hl_y + 8], fill=(255, 210, 60, 255))

# ":#" after yellow line
try:
    font_ref = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 30)
except:
    font_ref = ImageFont.load_default()

d.text((hl_x2 + 5, hl_y - 14), ":#", font=font_ref, fill=(40, 160, 100, 255))

img.save("icon.png")
print("icon.png generated")
