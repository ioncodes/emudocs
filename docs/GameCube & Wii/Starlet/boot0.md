# boot0

Boot0 reads boot1 from NAND into SRAM, corrects read errors, decrypts it and checks its hash against OTP before handing over execution. See the [Starlet memory map](<../Starlet.md#memory-map>) for SRAM and ROM mappings.

## Entry and buffers

| ARM address               | Use                                                   |
| ------------------------- | ----------------------------------------------------- |
| `0xFFFF0000`              | Reset vector                                          |
| `0xFFFF0040`              | `reset`: sets the stack pointer and enters the loader |
| `0xFFFF0108`              | `load_boot1`                                          |
| `0x0D400000`-`0x0D4177FF` | boot1 buffer, 94 KiB                                  |
| `0x0D417800`              | First spare/ECC buffer                                |
| `0x0D417880`              | Second spare/ECC buffer                               |
| `0x0D417C00`              | Initial stack pointer                                 |
| `0xFFF00000`              | boot1 entry through the SRAM alias                    |

## Loading and verification

`load_boot1` writes `7` to [`HW_SRNPROT`](<../Starlet.md#hw_srnprot>), enabling SRAM access for NAND, SHA-1 and AES while leaving `SM` clear. It loads the AES key and IV from ROM and reads five OTP words, starting at index 0, as the expected hash.

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

`fatal_error` repeatedly writes the code to GPIO bits 23:16, delays, writes zero, and delays again.
