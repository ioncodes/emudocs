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

### PARAM.SFO

The parameter file is a table of named values. A 20 byte header is followed directly by 1 index entry of 16 bytes per value and each entry points into a key table holding the NULL-terminated value names and a data table holding the values themselves. The header gives both table offsets relative to the start of the parameter file.

| Offset | Size (bytes) | Description                     |
| ------ | ------------ | ------------------------------- |
| `0x00` | 4            | Magic `00 50 53 46` (`"\0PSF"`) |
| `0x04` | 4            | Version `0x00000101`            |
| `0x08` | 4            | Offset of the key table         |
| `0x0C` | 4            | Offset of the data table        |
| `0x10` | 4            | Number of index entries         |

Each index entry locates its name relative to the key table and its value relative to the data table.

| Offset | Size (bytes) | Description                                    |
| ------ | ------------ | ---------------------------------------------- |
| `0x00` | 2            | Offset of the name within the key table        |
| `0x02` | 2            | Value format                                   |
| `0x04` | 4            | Length of the stored value in bytes            |
| `0x08` | 4            | Space reserved for the value in the data table |
| `0x0C` | 4            | Offset of the value within the data table      |

| Format   | Value          |
| -------- | -------------- |
| `0x0204` | String         |
| `0x0404` | 32 bit integer |

A string's stored length may or may not count its terminating NULL and the reserved space may be larger than the stored length, so readers take the string up to the first NULL or the stored length, whichever comes first. The `TITLE` entry holds the program's title as a string.

## ELF Executables and PRX Modules

The ELF type in `e_type` decides whether an executable is tied to fixed addresses or can be relocated.

| `e_type` | Form                                             |
| -------- | ------------------------------------------------ |
| `0x0002` | Executable (`ET_EXEC`) linked at fixed addresses |
| `0xFFA0` | Relocatable module (PRX) linked at `0x00000000`  |

Since a PRX is linked with its loadable segment at virtual address `0x00000000`, it carries relocation sections that list the locations whose contents depend on the address the module ends up loaded at.

### PRX Relocation Sections

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

`R_MIPS_32` adds the load address to the data word. `R_MIPS_26` adds `load_address >> 2` to the 26 bit jump target in bits 25:0 of the instruction while leaving the opcode in bits 31:26 unchanged. `R_MIPS_HI16` and `R_MIPS_LO16` patch the 2 halves of an address that is built by a `lui` followed by an instruction with a sign extended 16 bit immediate. Because the entries have no addends, the upper half alone does not give the full address. An `R_MIPS_HI16` therefore takes its low half from the next `R_MIPS_LO16` entry that follows it. Several `R_MIPS_HI16` entries can share the same `R_MIPS_LO16`. The upper half is rounded so that it compensates for a low half that becomes negative after relocation.

```rust
// R_MIPS_HI16 at hi_address, paired with the next R_MIPS_LO16 at lo_address
let low = (read32(lo_address) as i16) as u32;
let full = (read32(hi_address) << 16).wrapping_add(low).wrapping_add(load_address);
write16(hi_address, (full.wrapping_add(0x8000) >> 16) as u16);

// R_MIPS_LO16 at lo_address
write16(lo_address, read32(lo_address).wrapping_add(load_address) as u16);
```

`read32` reads the original instruction, before any relocation has patched it. `write16` replaces the immediate in bits 15:0 of the instruction while leaving the upper 16 bits unchanged.

## Module Info and Imports

Every executable carries a module info structure in its `.rodata.sceModuleInfo` section, which names the module and points to the tables it uses to import functions from libraries in other modules. A PRX additionally stores the file offset of its module info in bits 30:0 of `p_paddr` in its program header. All addresses in these structures are linked addresses, so in a PRX each of them is covered by an `R_MIPS_32` relocation.

```d2
direction: right

module_info: Module info {
  shape: sql_table
  "0x04": name
  "0x20": gp
  "0x24": export table start
  "0x28": export table end
  "0x2C": import table start
  "0x30": import table end
}

import_entry: Import table entry {
  shape: sql_table
  "0x00": library name
  "0x08": entry size
  "0x0A": function count
  "0x0C": NID table
  "0x10": stub table
  "...": next entry
}

library_name: Library name {
  shape: sql_table
  "zero-terminated string"
}

stub_table: Stub table {
  shape: sql_table
  "stub 0": 'jr $ra; nop'
  "stub 1": 'jr $ra; nop'
  "...": ""
}

nid_table: NID table {
  shape: sql_table
  "NID 0"
  "NID 1"
  "..."
}

module_info."0x2C" -> import_entry
import_entry."0x00" -> library_name
import_entry."0x10" -> stub_table."stub 0"
import_entry."0x0C" -> nid_table
stub_table."stub 0" -- nid_table."NID 0": {style.stroke-dash: 3}
stub_table."stub 1" -- nid_table."NID 1": {style.stroke-dash: 3}
```

### Module Info

The module info structure is 52 bytes long.

| Offset | Size (bytes) | Description                                  |
| ------ | ------------ | -------------------------------------------- |
| `0x04` | 28           | Module name in ASCII, padded with zero bytes |
| `0x20` | 4            | Value of `$gp` for the module                |
| `0x24` | 4            | Start of the export table                    |
| `0x28` | 4            | End of the export table                      |
| `0x2C` | 4            | Start of the import table                    |
| `0x30` | 4            | End of the import table                      |

Each end address points just past the last byte of its table, so a module without imports or exports has equal start and end addresses for that table.

### Import Table

The import table holds 1 entry for each library the module imports from. Every entry states its own size in 32 bit words in the byte at offset `0x08` and is directly followed by the next entry, which makes the usual 5 word entry 20 bytes long.

| Offset | Size (bytes) | Description                                           |
| ------ | ------------ | ----------------------------------------------------- |
| `0x00` | 4            | Address of the library name, a zero-terminated string |
| `0x08` | 1            | Entry size in 32 bit words                            |
| `0x0A` | 2            | Number of imported functions                          |
| `0x0C` | 4            | Address of the NID table                              |
| `0x10` | 4            | Address of the stub table                             |

The NID table holds a 4 byte NID for every imported function and the stub table holds an 8 byte stub for every imported function, both in the same order, so the NID at index `n` identifies the function behind stub `n`. Code calls an imported function with a `jal` to the start of its stub. In the executable file, every stub consists of `jr $ra` (`0x03E00008`) followed by `nop` (`0x00000000`).

A NID identifies a function by number instead of by name. Most NIDs are the first 4 bytes of the SHA-1 digest of the function name, combined into a 32 bit value as shown below. Some NIDs do not follow this rule, so a loader has to treat every NID as an opaque identifier.

```rust
let digest = sha1(function_name);
let nid = u32::from_le_bytes([digest[0], digest[1], digest[2], digest[3]]);
```
