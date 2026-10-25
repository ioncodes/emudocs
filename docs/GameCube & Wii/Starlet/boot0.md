# boot0

Boot0 reads boot1 from NAND into SRAM, corrects read errors, decrypts it and checks its hash against OTP before handing over execution. See the [Starlet memory map](<index.md#memory-map>) for SRAM and ROM mappings.

## Entry and buffers

The reset vector at `0xFFFF0000` jumps to `reset` (`0xFFFF0040`), which sets the stack pointer and starts the loader.

| ARM address               | Use                                |
| ------------------------- | ---------------------------------- |
| `0xFFFF0000`              | Reset vector                       |
| `0x0D400000`-`0x0D4177FF` | boot1 buffer, 94 KiB               |
| `0x0D417800`              | First spare/ECC buffer             |
| `0x0D417880`              | Second spare/ECC buffer            |
| `0x0D417C00`              | Initial stack pointer              |
| `0xFFF00000`              | boot1 entry through the SRAM alias |

## Loading and verification

`load_boot1` (`0xFFFF0108`) writes `7` to [`HW_SRNPROT`](<index.md#hw_srnprot>) (`0x0D800060`), which enables SRAM access for NAND, SHA-1 and AES and leaves `SM` clear. It then loads the AES key and IV from ROM and reads the expected hash from five OTP words, starting at index 0.

```c
expected_hash = OTP_ReadWords(0, 5);

for (page = 0; page < 47; page++) {
    NAND_ReadPage(page, boot1 + page * 2048, spare);
    if (!ECC_CorrectPage(boot1 + page * 2048, spare))
        fatal_error(0xF1);
}

AES_CBC_Decrypt(boot1, 0x17800, rom_key, rom_iv);
actual_hash = SHA1_CalculateBlocks(boot1, 0x17800);

if (!AllZero(expected_hash) && actual_hash != expected_hash)
    fatal_error(0xF2);

jump(0xFFF00000);
```

## Errors

| Code   | Meaning                 |
| ------ | ----------------------- |
| `0xF1` | Uncorrectable ECC error |
| `0xF2` | boot1 hash mismatch     |

`fatal_error` (`0xFFFF00A4`) repeatedly writes the code to GPIO bits 23:16, waits, writes zero and waits again.
