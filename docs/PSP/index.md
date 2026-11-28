# PSP

The PSP's CPU is a MIPS processor running in little endian mode and the PSP file formats store multibyte values in the same byte order.

| Page                              | Topics                                                                |
| --------------------------------- | --------------------------------------------------------------------- |
| [Controller](Controller.md)       | Button bitfield and analog stick input                                |
| [Display](Display.md)             | Screen resolution, vertical sync timing and framebuffer layout        |
| [Executables](Executables.md)     | PBP packages, PARAM.SFO, ELF executables, PRX relocations and imports |
| [Graphics Engine](GE.md)          | Display lists, color formats, vertices, textures, CLUT and alpha test |
| [Library Functions](Libraries.md) | Imported firmware functions with their NIDs, arguments and results    |
| [Threads](Threads.md)             | Thread states and scheduling                                          |

## Address Space

The CPU's virtual address space is divided into a user and a kernel part, each with a cached and an uncached space. The 2 spaces of a pair map the same memory, so a program chooses whether an access goes through the cache by the address it uses. For user addresses, bit 30 selects between cached (0) and uncached (1) access while bits 28:0 hold the physical address. Memory itself is divided into a kernel area and a user area. The kernel area is protected against illegal access.

| Base address | Space            |
| ------------ | ---------------- |
| `0x00000000` | User, cached     |
| `0x40000000` | User, uncached   |
| `0x80000000` | Kernel, cached   |
| `0xA0000000` | Kernel, uncached |
