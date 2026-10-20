GX (Flipper/Hollywood GPU) notes from [Gecko](https://github.com/ioncodes/gecko), see [Games](<Games.md>) for the bugs these caused

## Vertex Skip

An indexed **position** with all bits set means "skip this vertex":

```
format    reserved index    meaning
----------------------------------------
8-bit     0xFF              skip vertex
16-bit    0xFFFF            skip vertex
```

Only applies to the indexed position field! Other fields use `0xFF` according to their own format (e.g. alpha `0xFF` = opaque). Documented in Nintendo's [US6700586B1 patent](https://patents.google.com/patent/US6700586B1/en).

A skipped record doesn't occupy a corner in the strip, so `0, 1, SKIP, 2, 3` is the same quad as `0, 1, 2, 3`.

The bytes still exist though! E.g. 8-bit position index + RGBA color is 5 bytes, skipped or not. The parser must consume the full record (using the current vertex format), otherwise it reads a color byte as the next position index and loses its place:

```
for each vertex record in the draw:
    record = consume the complete record using the current format

    if its indexed position is the reserved all ones value:
        continue

    decode the record and append its vertex

assemble the draw's triangles from the retained vertices
```

* Filter skipped records **before** vertex decoding
* Update the vertex count **per draw**, otherwise a removed record can join one draw's vertices to the next
* Depth plane tracking for [z-freeze](#z-freeze) needs to agree on which triangles exist, so it has to run on the filtered list

Code: [`filter_skipped_vertices`](https://github.com/ioncodes/gecko/blob/07a030f8d1aae494cac0e061c135ed0c75b45ff9/crates/gecko/src/flipper/gx/vertex.rs#L21)

Test: [vertex-skip](https://github.com/ioncodes/gamecube-wii-tests/tree/be7a2e6f79d9691b9dd2c3308bf56dcf466e703b/vertex-skip) (direct, 8-bit and 16-bit indices, all 3 should match)

## z-freeze

Lets a draw reuse the depth plane of an earlier triangle instead of its own depth. libogc: `GX_SetCoPlanar(GX_ENABLE)`.

* While z-freeze is **off**, every triangle replaces the saved plane
* While it's **on**, the last plane is kept and following draws evaluate it for depth (own outline/colors/UVs, borrowed depth)
* The reference triangle doesn't need to write color or depth to establish a plane

Plane from the 3 screen space vertices:

```
depth(x, y) = A*x + B*y + C
```

Evaluated for every pixel of the new draw, **including pixels outside the original triangle**, so the result can leave the 0-1 range (see below). Degenerate (line/point) triangles don't define a plane.

Dolphin's [January 2015 progress report](https://dolphin-emu.org/blog/2015/02/01/dolphin-progress-report-january-2015/) also covers this.

### Plane Overflow

Clamping the extrapolated depth to max is **wrong**. Hardware readbacks (`GX_ALWAYS` write, `GX_PeekZ` read), horizontal and vertical slopes give the same values:

```
plane depth    Wii Z24     ~
----------------------------------
0.25           0x400000    0.25
1.25           0xFFFFFF    1
4.25           0x000000    0
8.25           0x3FF7E0    0.25
12.25          0x000000    0
16.25          0x3FEFC0    0.25
```

Looks like a value overflowing every 8 depth units before being clamped, which fits a **signed 27-bit intermediate** (`2^27 / 2^24 = 8`, range -4 to <+4):

* 4.25 wraps to -3.75 -> clamped to 0
* 8.25 is a full cycle -> back to 0.25

Note: wrapping with `% 1.0` gives narrow stripes instead of the broad bands seen on hardware. 27-bit is just what matches, not proven, and some exact readings still differ.

Code: [plane calculation](https://github.com/ioncodes/gecko/blob/07a030f8d1aae494cac0e061c135ed0c75b45ff9/crates/gecko/src/flipper/gx/depth.rs), [depth shader w/ overflow](https://github.com/ioncodes/gecko/blob/88a8a110219d4152739427c216b3ae824b094a8c/crates/backend-wgpu/src/shaders/main.wesl)

Test: [z-freeze](https://github.com/ioncodes/gamecube-wii-tests/tree/db2f3ad67914d6b3e105cfd7ac0d2c859b85a115/z-freeze) (sloped planes), [original 2-panel test](https://github.com/ioncodes/gamecube-wii-tests/tree/be7a2e6f79d9691b9dd2c3308bf56dcf466e703b/z-freeze)

Honorary mention: hazelwiss (hardware testing)

## TEV Wrapping

TEV results must be reduced to 8 bits by **wrapping** (keep low byte), not clamping, and not left wide. Unclamped stages keep a signed intermediate of -1024..1023.

Where the wrap happens matters:

* **A/B/C inputs** read only the low byte of a register
* **D input** keeps the wide (signed) value
* **Final RGB/alpha output** keeps the low byte before alpha test / blending

Making every stored register 8 bits loses information too early (breaks D).

* Input wrapping alone fixes Sunshine but not Galaxy (the eye stage creates the overflow itself)
* Output wrapping alone fixes Galaxy and makes Sunshine *almost* right (off by 2)

Other bits:

* C factor is expanded to `C + (C >> 7)` before multiplying so 255 represents exactly 1
* Scaled additions round by adding 128 before `>> 8`

Commit [`14aae5a`](https://github.com/ioncodes/gecko/commit/14aae5a5c406e0a2e7c83dffa0f2564b984d8d96): integer arithmetic in the regular combiners, A/B/C inputs wrapped to 8 bits, final RGB/alpha wrapped before testing. Still a mixed implementation (combiner in ints, TEV registers as normalized floats), not sure yet what the implications are.

Dolphin: [Pixel Processing Problems](https://dolphin-emu.org/blog/2014/03/15/pixel-processing-problems/)
