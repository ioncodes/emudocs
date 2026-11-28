# Emulator Field Notes

Notes, gotchas and game fixes collected while writing my emulators. Longer writeups live on [layle.me](https://layle.me).

## GameCube & Wii

- [GX](<GameCube & Wii/GX.md>): Vertex skip, z-freeze and TEV wrapping
- [Memory](<GameCube & Wii/Memory.md>): Write-gather pipe (WPAR) and ARAM DMA
- [Games](<GameCube & Wii/Games.md>): Game-specific bugs and fixes
- [Starlet](<GameCube & Wii/Starlet/index.md>): Starlet LLE stuff

## Game Boy Advance (GBA)

- [PPU](GBA/PPU.md): Bitmaps, tiles, sprites, windows, blending and affine layers

## PlayStation (PSX)

- [BIOS](PSX/BIOS.md): Boot behavior and getting to the BIOS shell
- [GPU](PSX/GPU.md): Rendering issues and GPU command handling
- [Games](PSX/Games.md): Game-specific bugs and fixes

## PlayStation Portable (PSP)

- [Overview](PSP/index.md): Byte order and virtual address space
- [Controller](PSP/Controller.md): Button bitfield and analog stick input
- [Display](PSP/Display.md): Screen resolution, vertical sync timing and framebuffer layout
- [Executables](PSP/Executables.md): PBP packages, PARAM.SFO, ELF executables, PRX relocations and imports
- [Graphics Engine](PSP/GE.md): Display lists, color formats, vertices, textures, CLUT and alpha testing
- [Library Functions](PSP/Libraries.md): Imported firmware functions with their NIDs, arguments and results
- [Threads](PSP/Threads.md): Thread states and scheduling
