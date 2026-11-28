# PSP

The PSP's CPU is a MIPS processor running in little endian mode and the PSP file formats store multibyte values in the same byte order.

- [Controller](Controller.md) - button and analog stick input
- [Display](Display.md) - screen resolution, timing and framebuffer layout
- [Executables](Executables.md) - PBP packages, ELF executables, PRX relocations and imports
- [Graphics Engine](GE.md) - display lists, vertices, textures, CLUT and rendering state
- [Library functions](Libraries.md) - imported firmware functions with their NIDs, arguments and results
- [Threads](Threads.md) - thread states and scheduling

## Address space

The CPU's virtual address space is divided into a user and a kernel part, each with a cached and an uncached space. The 2 spaces of a pair map the same memory, so a program chooses whether an access goes through the cache by the address it uses. For user addresses, bit 30 selects between cached (0) and uncached (1) access while bits 28:0 hold the physical address. Memory itself is divided into a kernel area and a user area. The kernel area is protected against illegal access.

| Base address | Space            |
| ------------ | ---------------- |
| `0x00000000` | User, cached     |
| `0x40000000` | User, uncached   |
| `0x80000000` | Kernel, cached   |
| `0xA0000000` | Kernel, uncached |
