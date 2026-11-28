# Graphics Engine

The Graphics Engine (GE) is a fixed-function 3D and 2D rendering processor that acts as a bus master on the system bus and renders into 2 MiB of on-chip local eDRAM (reachable at physical address `0x04000000` via `sceGeEdramGetAddr`). Display lists, vertex buffers, index buffers, textures and CLUT buffers can live in either main memory or eDRAM, whereas framebuffers and depth buffers reside in eDRAM. Because GE command registers hold indeterminate values after reset, programs typically submit an initialization list that zeroes state registers before drawing. Programs submit display lists and register interrupt callbacks through `sceGe_user` (see [Library Functions](Libraries.md#scege_user)).

## Display Lists

A display list is a sequence of 32 bit commands in memory. Each command places an 8 bit opcode in bits 31:24 and a 24 bit argument in bits 23:0.

| Bits  | Name       | Description                 |
| ----- | ---------- | --------------------------- |
| 31:24 | `OPCODE`   | Command opcode              |
| 23:0  | `ARGUMENT` | Command-specific parameters |

The GE tracks its current read pointer (`MADR`) and a stall address (`SADR`), advancing `MADR` by 4 bytes per command. When `SADR` is non-zero, reading pauses as soon as `MADR` reaches `SADR` and resumes once the program updates `SADR` past `MADR` or clears it to 0, letting the CPU append commands while the GE is already executing earlier ones.

### Flow Control and Addressing

| Opcode | Name     | Description                                             |
| ------ | -------- | ------------------------------------------------------- |
| `0x08` | `JUMP`   | Set the list address to a relative target address       |
| `0x0A` | `CALL`   | Push the next list address and jump to a target         |
| `0x0B` | `RET`    | Pop a return address pushed by `CALL`                   |
| `0x0C` | `END`    | Stop reading the display list and raise `INTEND`        |
| `0x0F` | `FINISH` | Raise `INTFIN` once prior drawing completes             |
| `0x10` | `BASE`   | Set the upper address bits for relative addresses       |
| `0x13` | `OFFSET` | Set the upper 24 bits of the offset register            |
| `0x14` | `ORIGIN` | Load the command's own address into the offset register |

`JUMP` (`0x08`) and `CALL` (`0x0A`) ignore the low 2 bits of the computed target address. Hardware `CALL` and `RET` support at most 2 nested levels of subroutine calls, while deeper nesting is handled by the graphics engine manager through `CMD_SIGNAL` extensions. `END` (`0x0C`) stops display list reading and raises a read-ended interrupt (`INTEND`), whereas `FINISH` (`0x0F`) waits for all preceding drawing operations to complete before raising a drawing-finished interrupt (`INTFIN`).

Commands that carry a 24 bit relative address (`VADR`, `IADR`, `JUMP`, `BJUMP` and `CALL`) form a 32 bit address by combining their 24 bit operand with `BASE` (`0x10`) and the offset register loaded by `OFFSET` (`0x13`) or `ORIGIN` (`0x14`).

```rust
// Relative address calculation for VADR, IADR, JUMP, BJUMP and CALL
let address = ((base << 24) | operand) + (offset << 8);
```

#### BASE (`0x10`)

| Bits  | Name   | Description                                   |
| ----- | ------ | --------------------------------------------- |
| 23:16 | `BASE` | Upper 8 bits of subsequent relative addresses |

#### OFFSET (`0x13`)

| Bits | Name   | Description                                              |
| ---- | ------ | -------------------------------------------------------- |
| 23:0 | `ADDR` | Upper 24 bits of the offset register (low 8 bits zeroed) |

#### FINISH (`0x0F`)

| Bits | Name    | Description                                              |
| ---- | ------- | -------------------------------------------------------- |
| 23:0 | `LABEL` | Label whose low 16 bits are passed to the finish handler |

## Color Formats

Framebuffers (`FPF`), direct-color textures (`TPF`), CLUT entries (`CPF`), vertex colors (`CT`) and display scanout all share the same 4 color encodings. Red occupies the least significant bits and alpha occupies the most significant bits, so a 32 bit `8:8:8:8` pixel lies in memory as `[R, G, B, A]`. In framebuffers, the alpha bits of `5:5:5:1`, `4:4:4:4` and `8:8:8:8` also act as the stencil buffer.

### 16 Bit 5:6:5:0 (`RGB565`)

| Bits  | Channel |
| ----- | ------- |
| 15:11 | Blue    |
| 10:5  | Green   |
| 4:0   | Red     |

### 16 Bit 5:5:5:1 (`RGBA5551`)

| Bits  | Channel |
| ----- | ------- |
| 15    | Alpha   |
| 14:10 | Blue    |
| 9:5   | Green   |
| 4:0   | Red     |

### 16 Bit 4:4:4:4 (`RGBA4444`)

| Bits  | Channel |
| ----- | ------- |
| 15:12 | Alpha   |
| 11:8  | Blue    |
| 7:4   | Green   |
| 3:0   | Red     |

### 32 Bit 8:8:8:8 (`RGBA8888`)

| Bits  | Channel |
| ----- | ------- |
| 31:24 | Alpha   |
| 23:16 | Blue    |
| 15:8  | Green   |
| 7:0   | Red     |

## Vertices and Primitives

| Opcode | Name    | Description                                    |
| ------ | ------- | ---------------------------------------------- |
| `0x01` | `VADR`  | Set the vertex data pointer (relative address) |
| `0x04` | `PRIM`  | Draw a primitive from the current vertex data  |
| `0x12` | `VTYPE` | Select the vertex layout and transform mode    |
| `0x55` | `MAC`   | Model ambient RGB color                        |
| `0x58` | `MAA`   | Model ambient alpha                            |

`PRIM` (`0x04`) draws `COUNT` vertices starting at the address set by `VADR` (`0x01`) and advances the vertex pointer past the consumed vertices.

### PRIM (`0x04`)

| Bits  | Name    | Description        |
| ----- | ------- | ------------------ |
| 18:16 | `PRIM`  | Primitive type     |
| 15:0  | `COUNT` | Number of vertices |

| Value | Primitive      |
| ----- | -------------- |
| 0     | Points         |
| 1     | Lines          |
| 2     | Line strip     |
| 3     | Triangles      |
| 4     | Triangle strip |
| 5     | Triangle fan   |
| 6     | Rectangles     |

`Rectangles` (`6`) consumes vertices in pairs representing opposite corners of an axis-aligned rectangle in drawing coordinates, allowing multiple rectangles per `PRIM` when `COUNT` is a multiple of 2. Every pixel of the rectangle uses the color and depth of the 2nd vertex, while texture coordinates interpolate between the 2 corners (which allows flipping the texture horizontally or vertically by swapping endpoint coordinates). Pixels on the left and top edges are drawn while pixels on the right and bottom edges are excluded.

### VTYPE (`0x12`)

| Bits  | Name  | Description                |
| ----- | ----- | -------------------------- |
| 23    | `TRU` | Transform mode             |
| 20:18 | `MC`  | Morph vertex count minus 1 |
| 16:14 | `WC`  | Weight count minus 1       |
| 12:11 | `IT`  | Index format               |
| 10:9  | `WT`  | Weight format              |
| 8:7   | `VT`  | Position format            |
| 6:5   | `NT`  | Normal format              |
| 4:2   | `CT`  | Color format               |
| 1:0   | `TT`  | Texture coordinate format  |

| Value | `TT`, `WT` format     | `NT`, `VT` format        | `IT` format |
| ----- | --------------------- | ------------------------ | ----------- |
| 0     | None                  | None (reserved for `VT`) | None        |
| 1     | 8 bit unsigned fixed  | 8 bit signed fixed       | 8 bit       |
| 2     | 16 bit unsigned fixed | 16 bit signed fixed      | 16 bit      |
| 3     | 32 bit float          | 32 bit float             | Reserved    |

| Value | `CT` color format |
| ----- | ----------------- |
| 0     | None              |
| 4     | 16 bit 5:6:5:0    |
| 5     | 16 bit 5:5:5:1    |
| 6     | 16 bit 4:4:4:4    |
| 7     | 32 bit 8:8:8:8    |

When `TRU` is 0 (normal mode), vertices pass through the full geometry pipeline. When `TRU` is 1 (through mode), coordinates are supplied directly in drawing space with `(0, 0)` at the top left and the GE bypasses vertex blending, lighting, non-UV texture mapping, clipping, fogging, the depth range test, object culling and patch culling. Weights and normals cannot be used in through mode. Instead, texel coordinates (`U`, `V`) are read as 16 bit unsigned integers in texel units rather than normalized `0.0` to `1.0` values, while drawing coordinates (`X`, `Y`, `Z`) are either 16 bit signed integers for `X` and `Y` paired with an unsigned 16 bit `Z` or 32 bit floats.

Within each vertex, present attributes appear in the fixed order of weights, texture coordinates (`U`, `V`), color, normal (`X`, `Y`, `Z`) and position (`X`, `Y`, `Z`). Vertex storage follows C structure alignment rules, so 16 bit fields align to 2 bytes, 32 bit fields align to 4 bytes and the total vertex stride rounds up to the alignment of its largest component.

When `CT` is 0, vertices take their RGB color from `MAC` (`0x55`) and their alpha from `MAA` (`0x58`).

### MAC (`0x55`)

| Bits  | Name | Description     |
| ----- | ---- | --------------- |
| 23:16 | `B`  | Blue component  |
| 15:8  | `G`  | Green component |
| 7:0   | `R`  | Red component   |

### MAA (`0x58`)

| Bits | Name | Description     |
| ---- | ---- | --------------- |
| 7:0  | `A`  | Alpha component |

## Framebuffer and Clear Mode

| Opcode | Name    | Description                                         |
| ------ | ------- | --------------------------------------------------- |
| `0x9C` | `FBP`   | Low 24 bits of the draw framebuffer offset in eDRAM |
| `0x9D` | `FBW`   | Framebuffer stride in pixels and upper address bits |
| `0xD2` | `FPF`   | Framebuffer pixel format                            |
| `0xD3` | `CMODE` | Clear mode enable and target buffer masks           |

`FBP` (`0x9C`) specifies the framebuffer base in 8 KiB units with its low 13 bits set to 0. `FBW` (`0x9D`) holds the upper 8 bits of the base address in `BASE` and the pixel stride in `FBW`, which must be a multiple of 64 from 64 to 1024 (the low 6 bits are ignored).

### FBW (`0x9D`)

| Bits  | Name   | Description                                  |
| ----- | ------ | -------------------------------------------- |
| 23:16 | `BASE` | Upper 8 bits of the framebuffer base address |
| 10:0  | `FBW`  | Framebuffer row stride in pixels (64-1024)   |

### FPF (`0xD2`)

| Bits | Name  | Description                                                                   |
| ---- | ----- | ----------------------------------------------------------------------------- |
| 1:0  | `FPF` | Framebuffer pixel format (`0` 5:6:5:0, `1` 5:5:5:1, `2` 4:4:4:4, `3` 8:8:8:8) |

### CMODE (`0xD3`)

| Bits | Name  | Description                                |
| ---- | ----- | ------------------------------------------ |
| 10   | `ZEN` | Update depth buffer when clear mode is on  |
| 9    | `AEN` | Update alpha/stencil when clear mode is on |
| 8    | `CEN` | Update color buffer when clear mode is on  |
| 0    | `SET` | 0 for normal drawing, 1 for clear mode     |

When clear mode is active (`SET = 1`), the GE switches to a clearing context that disables back face culling, texturing, fogging, antialiasing, the stencil test, the color test, alpha blending and logical operations while forcing both the alpha test and depth test to ALWAYS. Primitives drawn in clear mode (typically through-mode rectangles) then write their color, alpha and depth directly to whichever buffers are enabled by `CEN`, `AEN` and `ZEN`.

## Textures and CLUT

| Opcode        | Name         | Description                                  |
| ------------- | ------------ | -------------------------------------------- |
| `0x1E`        | `TME`        | Enable or disable texturing (bit 0)          |
| `0xA0`-`0xA7` | `TBP0`-`7`   | Low 24 bits of mipmap level 0-7 address      |
| `0xA8`-`0xAF` | `TBW0`-`7`   | Level 0-7 texture stride and upper address   |
| `0xB0`        | `CBP`        | Low 24 bits of CLUT source address           |
| `0xB1`        | `CBW`        | Upper 8 bits of CLUT source address          |
| `0xB8`-`0xBF` | `TSIZE0`-`7` | Level 0-7 texture width and height exponents |
| `0xC2`        | `TMODE`      | Texture storage mode and mipmap settings     |
| `0xC3`        | `TPF`        | Texture pixel format                         |
| `0xC4`        | `CLOAD`      | Load entries into the internal CLUT          |
| `0xC5`        | `CLUT`       | CLUT format, shift, mask and entry offset    |
| `0xC9`        | `TFUNC`      | Texture combine function                     |
| `0xCB`        | `TFLUSH`     | Flush the texture cache                      |

Each texture level's base address is `((TBWn.BASE << 24) | TBPn)` aligned to 16 bytes (the low 4 bits of `TBPn` are ignored) and its dimensions are `1 << TW` pixels wide by `1 << TH` pixels tall, with `TW` and `TH` ranging from 0 to 9 (1 to 512 pixels).

### TBW0-7 (`0xA8`-`0xAF`)

| Bits  | Name   | Description                                     |
| ----- | ------ | ----------------------------------------------- |
| 23:16 | `BASE` | Upper 8 bits of the texture buffer base address |
| 10:0  | `TBW`  | Texture row stride in texels (maximum 1024)     |

Because texture rows must align to 16 bytes, `TBW` is restricted to multiples of 4 for 32 bit formats (`8:8:8:8`, `Index32`, `DXT3` and `DXT5`), multiples of 8 for 16 bit formats (`5:6:5:0`, `5:5:5:1`, `4:4:4:4`, `Index16` and `DXT1`), multiples of 16 for `Index8` and multiples of 32 for `Index4`.

### TSIZE0-7 (`0xB8`-`0xBF`)

| Bits | Name | Description                              |
| ---- | ---- | ---------------------------------------- |
| 11:8 | `TH` | Texture height exponent (`1 << TH`, 0-9) |
| 3:0  | `TW` | Texture width exponent (`1 << TW`, 0-9)  |

### TMODE (`0xC2`)

| Bits  | Name  | Description                                        |
| ----- | ----- | -------------------------------------------------- |
| 18:16 | `MXL` | Maximum mipmap level (0-7)                         |
| 8     | `MC`  | Use separate CLUT ranges per mipmap level when set |
| 0     | `HSM` | 0 for linear layout, 1 for swizzled fast layout    |

In linear layout (`HSM = 0`), rows are stored sequentially in memory with a stride of `TBW` texels per row even when `TBW` is wider than `1 << TW`, so decoding reads `TBW * height` texels and takes the first `1 << TW` texels of each row. In fast layout (`HSM = 1`), texels are rearranged into 16 byte by 8 pixel blocks matching the replacement unit of the GE's 8 KiB, 4-way set-associative texture cache, requiring `TBW` to match the texture width and excluding DXT formats. Because the texture cache retains previously read texels, software must issue `TFLUSH` (`0xCB`) after modifying or switching texture data before drawing with it.

### TPF (`0xC3`)

| Bits | Name  | Description                         |
| ---- | ----- | ----------------------------------- |
| 8    | `EXT` | DXT 5:6:5 expansion (0 zero, 1 MSB) |
| 3:0  | `TPF` | Texture pixel format                |

| Value | Format                   |
| ----- | ------------------------ |
| 0     | 16 bit 5:6:5:0           |
| 1     | 16 bit 5:5:5:1           |
| 2     | 16 bit 4:4:4:4           |
| 3     | 32 bit 8:8:8:8           |
| 4     | 4 bit index (`Index4`)   |
| 5     | 8 bit index (`Index8`)   |
| 6     | 16 bit index (`Index16`) |
| 7     | 32 bit index (`Index32`) |
| 8     | DXT1                     |
| 9     | DXT3                     |
| 10    | DXT5                     |

In `Index4` textures, each byte holds 2 texels with the first texel in bits 3:0 and the second in bits 7:4 (8 texels per 32 bit word). In `Index8` textures, each byte is 1 texel index (4 texels per 32 bit word).

### TFUNC (`0xC9`)

| Bits | Name  | Description                |
| ---- | ----- | -------------------------- |
| 16   | `CD`  | Double output RGB when set |
| 8    | `TCC` | 0 for RGB only, 1 for RGBA |
| 2:0  | `TXF` | Texture combine function   |

`TFUNC` combines the sampled texture color `t` with the primary fragment color `p` (and texture environment color `e` from `TEC` `0xCA` for `BLEND`) before clamping each channel to 0-255. Below, `mul(x, y)` denotes `x * y / 255`.

| `TXF` | Function | `TCC = 0` (RGB)                                | `TCC = 1` (RGBA)                                         |
| ----- | -------- | ---------------------------------------------- | -------------------------------------------------------- |
| 0     | Modulate | `rgb = mul(t, p)`, `a = p.a`                   | `rgb = mul(t, p)`, `a = mul(t.a, p.a)`                   |
| 1     | Decal    | `rgb = t`, `a = p.a`                           | `rgb = mul(255 - t.a, p) + mul(t.a, t)`, `a = p.a`       |
| 2     | Blend    | `rgb = mul(255 - t, p) + mul(t, e)`, `a = p.a` | `rgb = mul(255 - t, p) + mul(t, e)`, `a = mul(t.a, p.a)` |
| 3     | Replace  | `rgb = t`, `a = p.a`                           | `rgb = t`, `a = t.a`                                     |
| 4     | Add      | `rgb = t + p`, `a = p.a`                       | `rgb = t + p`, `a = mul(t.a, p.a)`                       |

### CLUT

The GE contains a 1024 byte internal color lookup table (CLUT) that holds up to 512 entries in 16 bit color formats or 256 entries in 32 bit `8:8:8:8`. `CLOAD` (`0xC4`) copies `NP * 32` bytes into the CLUT from physical address `((CBW.BASE << 24) | CBP)` (`CBP` is 16 byte aligned with its low 4 bits ignored). That corresponds to `16 * NP` entries for 16 bit formats or `8 * NP` entries for 32 bit `8:8:8:8`, with `NP` ranging from 1 to 32.

#### CLOAD (`0xC4`)

| Bits | Name | Description                             |
| ---- | ---- | --------------------------------------- |
| 5:0  | `NP` | Number of 32 byte blocks to load (1-32) |

#### CLUT (`0xC5`)

| Bits  | Name  | Description                                                             |
| ----- | ----- | ----------------------------------------------------------------------- |
| 20:16 | `CSA` | Palette start offset in 16 entry units                                  |
| 15:8  | `MSK` | Mask applied to the shifted 8 bit texel index                           |
| 6:2   | `SFT` | Right shift applied to the zero-extended index                          |
| 1:0   | `CPF` | Entry color format (`0` 5:6:5:0, `1` 5:5:5:1, `2` 4:4:4:4, `3` 8:8:8:8) |

To look up a texel index from an indexed texture, the GE zero-extends the index to 32 bits, shifts right by `SFT`, takes the low 8 bits masked by `MSK` and combines `CSA * 16` using a bitwise OR rather than addition (so `MSK` must leave any bits used by `CSA` clear).

```rust
// CLUT entry lookup
let shifted = ((index as u32) >> sft) & 0xFF;
let entry = (shifted & (msk as u32)) | ((csa as u32) << 4);
```

## Alpha Test

| Opcode | Name    | Description                             |
| ------ | ------- | --------------------------------------- |
| `0x22` | `ATE`   | Enable or disable alpha test (bit 0)    |
| `0xDB` | `ATEST` | Alpha test function, reference and mask |

### ATEST (`0xDB`)

| Bits  | Name   | Description                                    |
| ----- | ------ | ---------------------------------------------- |
| 23:16 | `AMSK` | Mask applied to both fragment alpha and `AREF` |
| 15:8  | `AREF` | Reference alpha value (0-255)                  |
| 2:0   | `ATF`  | Comparison function                            |

When alpha testing is enabled, a fragment is kept only when `(alpha & amsk)` satisfies `ATF` against `(aref & amsk)`.

| Value | Function         |
| ----- | ---------------- |
| 0     | Never            |
| 1     | Always           |
| 2     | Equal            |
| 3     | Not equal        |
| 4     | Less             |
| 5     | Less or equal    |
| 6     | Greater          |
| 7     | Greater or equal |
