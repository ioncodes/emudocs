# boot2

[boot1](<boot1.md>) loads boot2 into MEM1 and jumps to its ELF loader.

## ELF loading

The ELF loader runs before the boot2 kernel. It first reads [`HW_SRNPROT`](<index.md#hw_srnprot>) and sets bit 5 (`SM`) if it is clear. While the boot ROM is enabled, this arrangement places SRAM bank A at `0xFFFF0000` (see [SRAM and boot ROM mapping](<index.md#sram-and-boot-rom-mapping>)).

The loader then walks the ELF program headers. For each header of type `PT_LOAD` (`1`), it copies `p_filesz` bytes from `ELF base + p_offset` to the physical address `p_paddr`. The kernel segments are among them and load at `0xFFFF0000` and above.

## Kernel entry

The kernel starts at `0xFFFF0000` with a jump to `init_kernel`. This routine invalidates the instruction and data caches. It then sets two bits in the CP15 control register `c1`, where bit 0 is the least significant bit:

| Bit | Name | Description                                   |
| --- | ---- | --------------------------------------------- |
| 12  | `I`  | Enables the instruction cache.                |
| 1   | `A`  | Enables alignment checking for data accesses. |

Alignment checking applies even while the memory management unit (MMU) is disabled. Word accesses must be aligned to 4 bytes and halfword accesses to 2 bytes. A misaligned access raises a Data Abort. Byte accesses never fault.

Next, `init_kernel` clears the kernel's uninitialized data, which lies in two SRAM ranges. The first range is in bank A at `0xFFFF0000` and above. Setting [`HW_BOOT0[12]`](<index.md#hw_boot0>) afterwards disables the boot ROM, which exposes bank B at `0xFFFE0000` for the second range:

```c
fill_word_range(0xFFFF9C80, 0xFFFFEB40, 0, 4);
HW_BOOT0 = HW_BOOT0 | (1u << 12);
fill_word_range(0xFFFE0000, 0xFFFE7CC0, 0, 4);
```

`fill_word_range(start, end, value, stride)` writes the 32 bit `value` to `start`, `start + stride` and so on, as long as the address is below `end`.

Finally, `init_kernel` sets the stack pointer of each privileged mode and jumps to `kernel_main` in Thumb state.
