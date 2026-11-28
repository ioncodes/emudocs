# Display

The PSP's LCD panel has a fixed active resolution of 480 by 272 square pixels and a theoretical vertical sync frequency of 59.94005995 Hz. Each vertical frame period spans 286 scanlines in total, combining the 272 active lines with a 14 line vertical blanking interval. Programs configure the display mode, flip framebuffers and synchronize to vertical blanking through `sceDisplay` (see [Library functions](Libraries.md#scedisplay)).

## Framebuffer

The display scans out a linear framebuffer from the graphics engine's local eDRAM, starting at the top left pixel and advancing each row by a pixel stride (`buffer_width`) that must be a multiple of 64 (commonly 512). Setting the framebuffer address to NULL with a stride of 0 blacks out the screen.

Updates to the framebuffer address can take effect either on the next horizontal sync (`0`, `SCE_DISPLAY_UPDATETIMING_NEXTHSYNC`) or during the next vertical blanking interval (`1`, `SCE_DISPLAY_UPDATETIMING_NEXTVSYNC`). Changing the stride or pixel format cannot occur mid-frame and must use `SCE_DISPLAY_UPDATETIMING_NEXTVSYNC`.

The 4 supported pixel formats share the same bit layouts as the graphics engine (see [Color formats](GE.md#color-formats)).

| Value | Name                         | Format  | Bytes per pixel |
| ----- | ---------------------------- | ------- | --------------- |
| 0     | `SCE_DISPLAY_PIXEL_RGB565`   | 5:6:5:0 | 2               |
| 1     | `SCE_DISPLAY_PIXEL_RGBA5551` | 5:5:5:1 | 2               |
| 2     | `SCE_DISPLAY_PIXEL_RGBA4444` | 4:4:4:4 | 2               |
| 3     | `SCE_DISPLAY_PIXEL_RGBA8888` | 8:8:8:8 | 4               |
