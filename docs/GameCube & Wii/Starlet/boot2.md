# boot2

[boot1](<boot1.md>) loads boot2 into MEM1 and jumps to its ELF loader.

## ELF loading

The ELF loader runs before the boot2 kernel. It first reads [`HW_SRNPROT`](<index.md#hw_srnprot>) (`0x0D800060`) and sets bit 5 (`SM`) if it is clear. While the boot ROM is enabled, this arrangement places SRAM bank A at `0xFFFF0000` (see [SRAM and boot ROM mapping](<index.md#sram-and-boot-rom-mapping>)).

The loader then walks the ELF program headers. For each header of type `PT_LOAD` (`1`), it copies `p_filesz` bytes from `ELF base + p_offset` to the physical address `p_paddr`. The kernel segments are among them and load at `0xFFFF0000` and above.

## Kernel entry

The kernel starts at `0xFFFF0000` with a jump to `init_kernel` (`0xFFFF0054`). This routine invalidates the instruction and data caches. It then sets two bits in the CP15 control register `c1`:

| Bit | Name | Description                                   |
| --- | ---- | --------------------------------------------- |
| 12  | `I`  | Enables the instruction cache.                |
| 1   | `A`  | Enables alignment checking for data accesses. |

Alignment checking applies even while the memory management unit (MMU) is disabled. Word accesses must be aligned to 4 bytes and halfword accesses to 2 bytes. A misaligned access raises a Data Abort. Byte accesses never fault.

Next, `init_kernel` uses `fill_word_range` (`0xFFFF0040`) to clear the kernel's uninitialized data, which lies in two SRAM ranges. The first range is in bank A at `0xFFFF0000` and above. Setting [`HW_BOOT0[12]`](<index.md#hw_boot0>) (`0x0D80018C`) afterwards disables the boot ROM and exposes bank B at `0xFFFE0000` for the second range:

```c
fill_word_range(0xFFFF9C80, 0xFFFFEB40, 0, 4);
HW_BOOT0 = HW_BOOT0 | (1u << 12);
fill_word_range(0xFFFE0000, 0xFFFE7CC0, 0, 4);
```

`fill_word_range(start, end, value, stride)` writes the 32 bit `value` to `start`, `start + stride` and so on, as long as the address is below `end`.

Finally, `init_kernel` sets the stack pointer of each privileged mode and jumps to `kernel_main` (`0xFFFF0114`) in Thumb state.

## MMU initialization

boot2's kernel enables the MMU in `init_mmu` (`0xFFFF5184`). It first disables the MMU and the data cache and then builds a 16 KiB first-level translation table at physical `0x13850000`. All initial mappings are identity mappings. Wherever the address is 1 MiB aligned and at least 1 MiB of the range remains, `init_mmu` maps a 1 MiB section. Elsewhere it maps 4 KiB small pages through coarse second-level tables.

| Descriptor   | Type (bits `1:0`) | Base address bits |
| ------------ | ----------------- | ----------------- |
| Section      | 2                 | `31:20`           |
| Coarse table | 1                 | `31:10`           |
| Small page   | 2                 | `31:12`           |

A first-level descriptor with type `0` raises a section translation fault. The processor writes status `5` to the data fault status register and writes the faulting virtual address to the fault address register before taking a Data Abort.

Once the tables are built, `init_mmu` clears the data fault status, instruction fault status and fault address registers. It writes `0x13850000` to the translation table base register (CP15 `c2`) and calls `enable_mmu` (`0xFFFF237C`), which performs these steps in order:

1. Writes `0x55555555` to the domain access control register (CP15 `c3`), which makes all 16 domains clients.
2. Drains the write buffer.
3. Invalidates the instruction and data TLBs.
4. Reads the CP15 control register `c1`, sets bits 0 and 2 and writes it back.

| Bit | Name | Effect of the final control write |
| --- | ---- | --------------------------------- |
| 2   | `C`  | Enables the data cache            |
| 0   | `M`  | Enables the MMU                   |

## Kernel services

The [IOS](<ios/index.md>) page describes kernel services and module interfaces. [NAND initialization](<nand.md#boot2-initialization>) describes how boot2 submits NAND commands and handles their completion.
