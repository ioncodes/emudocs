# Executables

PSP programs are 32 bit ELF files with `e_machine` set to `8` (`EM_MIPS`), which come packaged in a PBP file together with their metadata when they are distributed for the system menu.

## PBP

A PBP file opens with a 40 byte header made up of a magic value, a version and a table of 8 offsets that locate the files packaged after the header. Each offset counts from the start of the PBP file.

| Offset        | Size (bytes) | Description                                 |
| ------------- | ------------ | ------------------------------------------- |
| `0x00`        | 4            | Magic `00 50 42 50` (`"\0PBP"`)             |
| `0x04`        | 4            | Version `0x00010000`                        |
| `0x08`        | 4            | Offset of the parameter file (`PARAM.SFO`)  |
| `0x0C`        | 4            | Offset of the icon image (PNG)              |
| `0x10`-`0x1C` | 16           | Offsets of 4 further packaged files         |
| `0x20`        | 4            | Offset of the executable (`DATA.PSP`)       |
| `0x24`        | 4            | Offset of the file following the executable |

The offset table never decreases, because the packaged files are stored back to back in table order. Each file extends from its own offset up to the next offset in the table, which means an absent file simply shares its offset with the entry that follows it.

The parameter file sits directly after the header at offset `0x28` and is recognizable by its magic `00 50 53 46` (`"\0PSF"`). The executable fills the bytes between the offsets at `0x20` and `0x24` and takes either of the 2 forms described below.

## ELF executables and PRX modules

The ELF type in `e_type` decides whether an executable is tied to fixed addresses or can be relocated.

| `e_type` | Form                                             |
| -------- | ------------------------------------------------ |
| `0x0002` | Executable (`ET_EXEC`) linked at fixed addresses |
| `0xFFA0` | Relocatable module (PRX) linked at `0x00000000`  |

Since a PRX is linked with its loadable segment at virtual address `0x00000000`, it carries relocation sections that list the locations whose contents depend on the address the module ends up loaded at.

### PRX relocation sections

Rather than using the standard `SHT_REL` (`9`) section type, PRX relocation sections are marked with `0x700000A0` in `sh_type`. Each section is an array of 8 byte entries without addends, where every entry names the location to patch and the kind of relocation to apply there.

| Offset | Size (bytes) | Name       | Description                             |
| ------ | ------------ | ---------- | --------------------------------------- |
| `0x00` | 4            | `r_offset` | Linked address of the location to patch |
| `0x04` | 4            | `r_info`   | Relocation type                         |

#### r_info

| Bits | Name   | Description     |
| ---- | ------ | --------------- |
| 7:0  | `TYPE` | Relocation type |

The relocation types follow the MIPS ELF numbering, with each one targeting a particular kind of instruction or data word.

| Type | Name          | Patched location                                          |
| ---- | ------------- | --------------------------------------------------------- |
| 0    | `R_MIPS_NONE` | Nothing                                                   |
| 2    | `R_MIPS_32`   | 32 bit data word holding an address                       |
| 4    | `R_MIPS_26`   | `j` or `jal` instruction                                  |
| 5    | `R_MIPS_HI16` | `lui` instruction                                         |
| 6    | `R_MIPS_LO16` | `addiu` or a load or store with a 16 bit immediate offset |
