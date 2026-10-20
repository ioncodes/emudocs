GBA PPU notes from [Sly](https://sly.layle.dev/). [GBATEK](https://problemkaputt.de/gbatek.htm) is the actual reference, this is the stuff I needed to know plus gotchas

## Timing

* 1'232 cycles per line, 228 lines per frame (160 visible + 68 VBLANK) = 280'896 cycles, ~59.73 FPS
* 240 visible pixels at 4 cycles each, but the HBLANK flag/IRQ only happens around cycle 1'006-1'008 (not 960!)
* `VCOUNT` (`0x04000006`) current line, `DISPSTAT` (`0x04000004`) IRQs for HBLANK, VBLANK, VCOUNT match

Games change registers between lines (HBLANK IRQ or HBLANK DMA) for per-line scroll, windows, affine matrices etc. Rendering a whole frame with the final register values loses all of that. I render each visible line at HBLANK with the state at that point. Mid-line changes would need finer timing.

## DISPCNT

```
0-2     Mode
3       CGB mode (BIOS only)
4       Displayed page (bitmap modes)
5       OAM access during HBLANK
6       Sprite tile mapping (0=2D, 1=1D)
7       Forced blank
8-12    BG0-BG3, OBJ enable
13-15   WIN0, WIN1, OBJ window enable
```

```
mode    BG0     BG1     BG2         BG3
-----------------------------------------------
0       text    text    text        text
1       text    text    affine      -
2       -       -       affine      affine
3       -       -       240x160 16bpp, 1 page
4       -       -       240x160 8bpp (palette), 2 pages
5       -       -       160x128 16bpp, 2 pages
```

Bitmap modes always draw on BG2 (bit 10 must be set) and use BG2's affine parameters, so bitmaps can be rotated/scaled too.

## Bitmap Modes

* Mode 3/5: pixel is the 15-bit color directly
* Mode 4: pixel is a palette index, `0x06000000 + 240y + x` (page 1 at `+0xA000`)
* Mode 4 index 0 is transparent (backdrop/sprites behind BG2 show through), same for area around a mode 5 image
* Bitmap modes eat the first half of OBJ VRAM, sprite tiles are limited to 512-1023
* Outside of a bitmap is always transparent, wraparound bit is ignored

### 8-bit VRAM Writes

VRAM can't be written 8 bits at a time. An `strb` to the **BG area** is duplicated into both bytes of the halfword, an `strb` to the **OBJ area** is ignored. [Source](https://problemkaputt.de/gbatek-gba-unpredictable-things.htm)

```rust
fn write_vram(&mut self, mut address: u32, width: Width, value: u32) {
    if width == Width::Byte {
        if self::vram_offset(address) >= self.obj_offset() {
            return;
        }

        address &= !1;
        self::write_memory(&mut self.vram, address + 1, width, value, self::vram_offset);
    }

    self::write_memory(&mut self.vram, address, width, value, self::vram_offset);
}
```

Note: OBJ area boundary depends on mode (`0x10000` in tiled modes, `0x14000` in bitmap modes).

## Colors

```
0-4     Red
5-9     Green
10-14   Blue
15      unused
```

BG palette at `0x05000000`, OBJ palette at `0x05000200`. Entry 0 of the BG palette is the backdrop.

5 to 8 bit: `(c << 3) | (c >> 2)`, otherwise 31 becomes 248 instead of 255.

## Text Backgrounds

```
BGxCNT
0-1     Priority
2-3     Tile block (16 KiB)
6       Mosaic
7       8bpp
8-12    Map block (2 KiB)
13      Wraparound (affine only)
14-15   Map size
```

* 4bpp: 32-byte tiles, **low nibble is the left pixel**, 16 banks of 16 colors
* 8bpp: 64-byte tiles, full 256-color palette
* Index 0 is transparent in every bank

```
map entry
0-9     Tile number
10      H flip
11      V flip
12-15   Palette bank
```

Maps are stored in 32x32 entry blocks (2 KiB), not as one big row-major array!

```
size    pixels      blocks
-------------------------------------------
0       256x256     SC0
1       512x256     SC0 SC1
2       256x512     SC0 / SC1
3       512x512     SC0 SC1 / SC2 SC3
```

```
block  = (ty / 32) * (W / 256) + (tx / 32)
offset = 2 * (32 * (ty % 32) + tx % 32)
entry  = 0x06000000 + 2048 * (map_block + block) + offset
```

Scroll (`BGxHOFS`/`BGxVOFS`, 9 bits) wraps at the map size, e.g. HOFS 337 on a 256 wide map is 81:

```rust
let bg_x = (x + bg.hofs as usize) & (width - 1);
```

Flipped tiles use `7 - px` / `7 - py`. Palette entry is `16 * bank + index` for 4bpp.

## Sprites (OBJ)

OAM at `0x07000000`, 128 entries of 8 bytes, 4th halfword belongs to affine matrices.

```
attr0
0-7     Y
8       Affine
9       Hide (regular) / double size (affine)
10-11   Mode (normal, semi-transparent, OBJ window)
12      Mosaic
13      8bpp
14-15   Shape (square, wide, tall, -)

attr1
0-8     X
9-13    Affine matrix number (affine)
12      H flip (regular)
13      V flip (regular)
14-15   Size

attr2
0-9     Tile number
10-11   Priority
12-15   Palette bank
```

```
size    square    wide     tall
------------------------------------
0       8x8       16x8     8x16
1       16x16     32x8     8x32
2       32x32     32x16    16x32
3       64x64     64x32    32x64
```

* OBJ tiles at `0x06010000 + 32n`. Tile numbers count 32-byte units even for 8bpp, so 8bpp sprites should use even numbers (lowest bit ignored in 2D mapping)
* 1D mapping: `n + ty * (w / 8) + tx`
* 2D mapping: `n + 32 * ty + tx`
* 8bpp: column offset doubles in both, row offset doubles in 1D only

### Position Wrap

Y is 8 bits and wraps, X is 9 bits and wraps at 512. A sprite at `y = 247` with height 32 shows up at the top of the screen.

```rust
let row = (line as u8).wrapping_sub(attr.y_coordinate()) as usize;
if row >= height {
    continue;
}
```

Affine double size sprites have a [Y wrapping exception](https://github.com/mgba-emu/mgba/issues/2824).

### Sprite vs Sprite

Lower priority number wins, on tie the lower OAM index wins. Iterating from entry 0 up, a later opaque pixel only replaces one with a **higher** priority number. [mGBA issue](https://github.com/mgba-emu/mgba/issues/2809)

```rust
if dst.is_none_or(|pixel| attr.priority() < pixel.priority) {
```

### Cycle Budget

1'210 cycles per line, 954 if `DISPCNT` bit 5 is set. Regular sprite costs 1 cycle per pixel of width, affine costs `10 + 2 * area width`. Once the budget runs out the rest of the line has no sprites, and offscreen sprites still count. [Source](https://problemkaputt.de/gbatek-lcd-obj-overview.htm)

## Layer Priority

* Lower priority number in front, on tie **lower BG number** wins
* Sprite goes in front of BGs with the **same or higher** priority number
* Backdrop is behind everything (treat it as priority `u8::MAX`)

```rust
bg_order.sort_by_key(|&(_, priority)| priority); // stable sort keeps BG order on ties

let (mut color, bg_priority) = bg_order
    .iter()
    .find_map(|&(index, priority)| bg_lines[index][x].map(|color| (color, priority)))
    .unwrap_or((backdrop, u8::MAX));

if let Some(sprite) = sprite_line[x]
    && sprite.priority <= bg_priority
{
    color = sprite.color;
}
```

Blending also needs the layer right behind the top one, so track the top 2.

## Windows

```
WINxH   0-7 X2 (right + 1)    8-15 X1 (left)
WINxV   0-7 Y2 (bottom + 1)   8-15 Y1 (top)

WININ   0-5 WIN0 (BG0-3, OBJ, effects)    8-13 WIN1
WINOUT  0-5 outside                       8-13 OBJ window
```

* Check order: WIN0 -> WIN1 -> OBJ window -> outside. First match wins
* OBJ window = opaque pixels of sprites with mode OBJ window (not drawn themselves). Needs `DISPCNT` bit 12 **and** 15
* No window enabled at all -> everything visible, effects allowed everywhere
* A layer still has to be enabled in `DISPCNT`

```rust
if let Some(index) = (0..2).find(|&index| windows.contains(index, x, y)) {
    return Some(WindowRegion::Rectangle(index));
}

Some(if windows.obj_enabled && inside_obj_window {
    WindowRegion::Obj
} else {
    WindowRegion::Outside
})
```

## Blending

```
BLDCNT
0-5     1st target (BG0-3, OBJ, BD)
6-7     Effect (0=none, 1=alpha, 2=brighten, 3=darken)
8-13    2nd target (BG0-3, OBJ, BD)
```

Only the topmost and the layer right behind it matter. Alpha needs top = 1st target **and** below = 2nd target.

```
alpha:     I = min(31, (I1 * EVA + I2 * EVB) >> 4)
brighten:  I = I + (((31 - I) * EVY) >> 4)
darken:    I = I - ((I * EVY) >> 4)
```

* EVA/EVB (`BLDALPHA` bits 0-4 / 8-12) and EVY (`BLDY`) treat **17-31 as 16**
* EVA + EVB can exceed 16, hence the `min(31)`
* Semi-transparent sprites alpha blend with the layer behind if it's a 2nd target, **regardless** of BLDCNT's 1st targets and effect
* Sprites can't blend with each other (already reduced to one sprite pixel)
* Window effects bit must be set in the pixel's region

## Mosaic

```
MOSAIC
0-3     BG width - 1
4-7     BG height - 1
8-11    OBJ width - 1
12-15   OBJ height - 1
```

Enabled per BG (`BGxCNT` bit 6) and per sprite (attr0 bit 12). BG blocks are aligned to the screen and take the top-left pixel's color, i.e. round the screen position down to the block start before lookup.

## Affine Backgrounds

Differences to text BGs:

* Always 8bpp, `BGxCNT` bit 7 ignored
* Map entry is 1 byte (tile number only, no flips/banks), max 256 tiles
* Map is square and plain row-major, no 32x32 blocks
* Scroll registers are ignored

```
size    pixels        map bytes
---------------------------------
0       128x128       256
1       256x256       1'024
2       512x512       4'096
3       1024x1024     16'384
```

The PPU walks from the screen back into the background. Parameters are signed 8.8 fixed point (`BGxPA`-`PD`, write only), reference point `BGxX`/`BGxY` is signed 20.8 (28 bits):

```
px = X + PA*x + PB*y
py = Y + PC*x + PD*y
texel = (px >> 8, py >> 8)
```

Bigger parameter = smaller picture (it's texels per pixel, not a zoom factor). For clockwise rotation `θ` with magnification `s`:

```
PA =  256*cos(θ)/s     PB = 256*sin(θ)/s
PC = -256*sin(θ)/s     PD = 256*cos(θ)/s
```

Note: GBATEK gives PB and PC the same sign, for a normal rotation they should be negatives of each other.

To keep BG point `(cx, cy)` at screen point `(sx, sy)`:

```
X = 256*cx - PA*sx - PB*sy
Y = 256*cy - PC*sx - PD*sy
```

Wraparound (`BGxCNT` bit 13) off -> outside of the map is transparent. Masking with all ones when off lets negative coordinates become huge `usize` and get caught by the same bounds check:

```rust
for dst in output.iter_mut() {
    let tx = ((x >> 8) as usize) & wrap_mask;
    let ty = ((y >> 8) as usize) & wrap_mask;
    x += matrix.pa;
    y += matrix.pc;

    if tx >= size || ty >= size {
        continue;
    }
    // ...
}
```

### Internal Reference Points

> *The above reference points are automatically copied to internal registers during each [VBLANK], specifying the origin for the first scanline. The internal registers are then incremented by dmx and dmy after each scanline.* [Source](https://problemkaputt.de/gbatek-lcd-i-o-bg-rotation-scaling.htm)

* Copy `BGxX`/`BGxY` to internal registers at VBLANK
* Add `PB`/`PD` to the internal ones after every line
* Writing `BGxX`/`BGxY` mid-frame updates the internal register **immediately**

```rust
/// Advances the internal reference points by PB/PD to the start of the next scanline.
fn step_reference_points(&mut self) {
    for i in 0..2 {
        let [_, pb, _, pd] = self.bg_matrix[i];
        self.bg_ref_internal[i][0] += pb.value();
        self.bg_ref_internal[i][1] += pd.value();
    }
}

fn reload_reference_points(&mut self) {
    self.bg_ref_internal = self.bg_ref.map(|point| point.map(ReferencePoint::value));
}
```

Using `Y + PD*line` instead of the internal register breaks anything that writes the matrix or reference point per line (mode 7 style roads).

## Affine Sprites

* Bit 9 of attr0 means **double size**, affine sprites can't be hidden with it
* No flip bits, negate `PA`+`PB` (H) or `PC`+`PD` (V) instead
* 32 matrices in OAM, matrix `m`: `PA` at `0x07000006 + 32m`, `PB`/`PC`/`PD` each 8 bytes after
* Transform is around the center of the sprite and the center of its on-screen area
* Double size makes the area `2w x 2h`, position is top left of that, center at `(x + w, y + h)`

```
tx = ((PA*dx + PB*dy) >> 8) + w/2
ty = ((PC*dx + PD*dy) >> 8) + h/2
```

`dx`/`dy` measured from the area center. Texels outside the sprite are transparent.

```rust
let (x, y) = if let Some(matrix) = matrix {
    let dx = col as i32 - (box_width / 2) as i32;
    let (tx, ty) = matrix.apply(dx, dy);
    let x = tx + (width / 2) as i32;
    let y = ty + (height / 2) as i32;

    let (Ok(x), Ok(y)) = (usize::try_from(x), usize::try_from(y)) else {
        continue;
    };

    if x >= width || y >= height {
        continue;
    }

    (x, y)
} else {
    attr.flip(col, row)
};
```

## Test Scenes

Games that exercise one specific feature really well:

* **OpenLara**: mode 4 page flipping (`DISPCNT` alternating `0x0404`/`0x0414`)
* **Game Boy Advance Video** cartridges: mode 3, 1000+ colors in a frame
* **Shaman King: Master of Spirits**: 4 text BGs with priorities, scrolling clouds
* **Action Man: Robot Atak**: mode 3 + sprites (tiles >= 512) on the map, 1D mapping, Y-wrapped health bar sprite
* **Tales of Phantasia** intro: WIN0/WIN1 reveal, darken fade restricted to WIN1 via effects bit
* **Fire Emblem** title: OBJ window (`WINOUT = 0x313e`), per-line BG0 scroll, alpha blend on lines 40-99
* **Golden Sun** opening: alpha blending with EVA + EVB > 16 (`BLDALPHA = 0x1006`)
* **The Minish Cap** intro: alpha fade with window effect bit masking the picture
* **Super Mario World** level entry: BG mosaic `0x1111` to `0xFFFF`, sprites unaffected
* **Wario Land 4**: Nintendo logo (affine scale), vortex (affine BG + double size affine sprite)
* **F-Zero: Maximum Velocity**: mode switch at line 32, HBLANK DMA writing BG2 matrix + reference point every line

Writeups: [Part 1: Bitmaps, Tiles and Palettes](https://layle.me/posts/gba-graphics-1-tiles/), [Part 2: Layers, Sprites and Blending](https://layle.me/posts/gba-graphics-2-layers/), [Part 3: Rotation, Scaling and Perspective](https://layle.me/posts/gba-graphics-3-affine/)

Honorary mention: Pdawg, Zayd
