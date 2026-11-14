"""Pack PNG images into a Windows .ico (PNG-compressed entries, Vista and later).

    python tools/make_icon.py out.ico icon256.png icon64.png icon48.png icon32.png icon16.png

The PNGs were rendered from img/easymeta.svg with headless Edge, e.g.
    msedge --headless=new --default-background-color=00000000 --window-size=256,256
           --screenshot=icon256.png page_with_the_svg.html
"""
import struct
import sys


def png_size(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    return struct.unpack(">II", data[16:24])


def main(out, pngs):
    images = [open(p, "rb").read() for p in pngs]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries, blobs = b"", b""
    for data in images:
        w, h = png_size(data)
        entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    with open(out, "wb") as f:
        f.write(header + entries + blobs)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
