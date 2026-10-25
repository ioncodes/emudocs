# boot1

boot1 is the second stage of the Starlet boot chain. [boot0](<boot0.md>) loads it into SRAM, decrypts and verifies it and jumps to `0xFFF00000`. boot1 then finds boot2 in NAND, checks its signature chain, decrypts and hashes it into MEM1 and jumps to it.

boot1 is a 94 KiB (`0x17800` byte) image. It starts executing through the `0xFFF00000` alias of SRAM but its pointers to its own data and to some of its own functions use the `0x0D400000` alias. Both aliases refer to the same memory. The [memory map](<index.md#memory-map>) shows the mappings.

## Entry

boot1 starts in ARM state at `0xFFF00000`. The entry code prepares the caches and the stack, calls the loader and then jumps to whatever address the loader returns. The instruction cache is enabled by bit 12 (`I`) of the CP15 control register, as described in [boot2 kernel entry](<boot2.md#kernel-entry>). It stays enabled only while the loader runs:

```c
void start(void)
{
    invalidate_icache();                 // MCR p15, 0, r0, c7, c5, 0
    invalidate_dcache();                 // MCR p15, 0, r0, c7, c6, 0
    cp15_control |= 1 << 12;             // enable the instruction cache
    memset32(bss_start, bss_end, 0, 4);  // the range is empty in boot1
    sp = 0x0D40EFFC;
    void *entry = load_boot2();          // Thumb code
    cp15_control &= ~(1 << 12);          // disable the instruction cache
    goto *entry;                         // MOV PC, R1, stays in ARM state
}
```

## Loader

`load_boot2` does all the work. It writes progress code `0x11` to bits 23:16 of `0x0D8000E0` (the same GPIO field that boot0 uses for its [error codes](<boot0.md#errors>)). It reads the byte at `0x0D800217` and writes `0x47` to [`HW_SRNPROT`](<index.md#hw_srnprot>) if the upper four bits of that byte are zero or `0x07` otherwise.

After that, boot1 makes up to two attempts to load boot2. The first attempt searches NAND blocks 1 to 7 in ascending order. If it fails, boot1 waits for the NAND, AES and SHA-1 engines to finish and tries again, this time searching from block 7 down to block 1. If the second attempt also fails, boot1 shows the error code forever.

```c
void *load_boot2(void)
{
    int error;

    debug_out(0x11);
    HW_SRNPROT = (read8(0x0D800217) >> 4) == 0 ? 0x47 : 0x07;

    for (int attempt = 1; attempt <= 2; attempt++) {
        int first = attempt == 1 ? 1 : 7;
        int step  = attempt == 1 ? +1 : -1;

        if (attempt == 2)
            wait_until_idle(NAND, AES, SHA1);

        read_block_map(&map);
        error = load(first, step, &map, &content);
        if (error == 0) {
            write32(content + 0x0C, 1);
            debug_out(0x22);
            return content + read32(content);
        }
    }

    for (;;) {
        debug_out(error);
        delay(1000000);
        debug_out(~error);
        delay(1000000);
    }
}
```

`debug_out(code)` writes the low byte of `code` to bits 23:16 of `0x0D8000E0`.

## Finding boot2

### Block map

Before each attempt, boot1 looks for a block map. It reads the last page (page 63) of every block from 1 to 7. Each of these pages can hold three copies of a 76 byte map, at offsets `0x00`, `0x4C` and `0x98`:

| Offset | Size | Contents                                        |
| ------ | ---- | ----------------------------------------------- |
| `0x00` | 8    | Magic, an 8 byte constant stored in boot1       |
| `0x08` | 4    | Generation number, big-endian                   |
| `0x0C` | 64   | One byte per block number, `1` means skip block |

A page only provides a map if at least two of its three copies are identical over all 76 bytes. boot1 uses copy 0 when its magic matches and it is identical to copy 1 or copy 2. Otherwise it uses copy 1 when its magic matches and it is identical to copy 2. If neither applies, the page provides no map. Out of all accepted copies in blocks 1 to 7, the one with the highest generation wins.

### Choosing a block

If the winning generation is greater than 1, boot1 trusts the map and skips every block whose byte is `1`. If there is no usable map, it checks the blocks directly instead: it reads pages 0 and 1 of the block and skips the block if the first spare byte of either page is not `0xFF`.

The first block that is not skipped, in the direction of the current attempt, holds the start of boot2. If no such block exists between 1 and 7, the attempt fails with error `-4`.

### Reading pages

boot1 reads a page by programming the NAND engine with these writes:

1. `0x0D010008` = `0`, `0x0D01000C` = page number, `0x0D010000` = `0x9F000000`.
2. Wait until bit 31 of `0x0D010000` reads as 0.
3. `0x0D010010` = data buffer address, `0x0D010014` = spare buffer address, `0x0D010000` = `0x8030B840`.

The function returns right away. boot1 waits for bit 31 of `0x0D010000` to clear before it uses the page and corrects every header and content page with [`ecc_correct`](#ecc-correction).

## boot2 layout

Page 0 of the boot2 block starts with a 32 byte header. All values are big-endian:

| Offset | Contents                                                    |
| ------ | ----------------------------------------------------------- |
| `0x00` | Header size, must be `0x20`                                 |
| `0x04` | Offset of the encrypted content from the start of the block |
| `0x08` | Size of the certificate chain                               |
| `0x0C` | Size of the ticket                                          |
| `0x10` | Size of the TMD                                             |

The content offset must not be larger than `0x20000` and must be a multiple of 64. Otherwise boot1 fails with error `-5`.

boot1 reads pages 0 up to `content_offset / 0x800` of the block into MEM1 at `0x00028000`. The certificate chain follows the header, the ticket follows the certificate chain and the TMD follows the ticket:

```text
0x00028000                header (0x20 bytes)
+ 0x20                    certificate chain
+ 0x20 + certs            ticket
+ 0x20 + certs + ticket   TMD
```

## Signature checks

boot1 checks five signed blobs. Each check copies the blob to MEM1 at `0x000AC000`, compares the 64 byte issuer field with the expected issuer string, hashes everything from the issuer field to the end of the blob with SHA-1 and checks an RSA signature over that hash:

```c
int verify_signed(const u8 *blob, const char *issuer, const u8 *modulus,
                  const u8 *exponent, int kind, u32 size)
{
    u8 *copy = (u8 *)0x000AC000;
    u32 body    = kind == 1 ? 0x240 : 0x140;  // kind 1: RSA-4096, kinds 2-4: RSA-2048
    u32 key_len = kind == 1 ? 0x200 : 0x100;

    memcpy(copy, blob, size);
    if (memcmp(copy + body, issuer, 64) != 0)
        return -8;

    u8 hash[20] = SHA1(copy + body, size - body);
    u8 m[key_len] = RSA_Public(copy + 4, modulus, exponent);  // m = sig^e mod n, big-endian
    if (strncmp(m + key_len - 20, hash, 20) != 0)
        return -8;

    return 0;
}
```

The signature starts at offset 4 of the blob. The 32 bit value at offset 0 is not looked at. The public exponent is stored as 4 big-endian bytes. boot1 drops any trailing zero bytes before using it.

The check has two vulns:

1. Only the last 20 bytes of `m` are compared with the hash. The padding in front of them is ignored.
2. The comparison uses `strncmp`, which stops at the first position where both strings contain a zero byte. If the first byte of the hash is `0x00` and the matching byte of `m` is also `0x00`, the check passes no matter what the remaining 19 bytes are.

The checks run in this order. Offsets are relative to the start of the certificate chain:

| Blob                   | Size     | Expected issuer                          | Key                                     |
| ---------------------- | -------- | ---------------------------------------- | --------------------------------------- |
| Certificate at `0x000` | `0x400`  | `Root`                                   | Root key stored in boot1 (RSA-4096)     |
| Certificate at `0x400` | `0x300`  | `Root-` + name of the first certificate  | Modulus at `0x2C8`, exponent at `0x3C8` |
| TMD                    | TMD size | `Root-` + first name + `-` + second name | Modulus at `0x5C8`, exponent at `0x6C8` |
| Certificate at `0x700` | `0x300`  | `Root-` + name of the first certificate  | Modulus at `0x2C8`, exponent at `0x3C8` |
| Ticket                 | `0x2A4`  | `Root-` + first name + `-` + third name  | Modulus at `0x8C8`, exponent at `0x9C8` |

The certificate names are stored at `0x284`, `0x584` and `0x884`. Before a name is used, boot1 checks its first two characters: they must be `CA`, `CP` and `XS` respectively or the attempt fails with error `-9`.

## Decryption and hashing

Once all signatures pass, boot1 decrypts the content key, checks the TMD and loads the content:

1. It decrypts the 16 bytes at offset `0x1BF` of the ticket with AES-128-CBC. The key is a constant stored in boot1. The IV is the 8 bytes at offset `0x18C` of the TMD followed by 8 zero bytes. This decryption happens in place at MEM1 `0x000B0000` and boot1 clears that buffer afterwards.
2. It checks that the two big-endian words at offsets `0x18C` and `0x190` of the TMD are both `1`. Otherwise the attempt fails with error `-11`.
3. It checks that the byte at offset `0x18B` of the TMD is at least version byte 0 of the [SEEPROM version record](#seeprom-version-record). If it is smaller or if no valid record can be read, the attempt fails with error `-10`.
4. It takes the content size from the word at offset `0x1F0` of the TMD and the expected SHA-1 hash from offset `0x1F4` and builds the content IV from the 2 bytes at offset `0x1E8` followed by 14 zero bytes.

The content then streams from NAND into MEM1. The page that contains the content offset is loaded to `0x00028000`, so the content itself starts at `0x00028000 + (content_offset & 0x7FF)`. Later pages follow in order. When boot1 reaches the end of a block, it continues with the next block in the direction of the current attempt, skipping blocks the same way as before. The content size is rounded up to a multiple of 16 bytes and the spare buffers are placed right behind the content. If `round_up(0x00028800 + (content_offset & 0x7FF) + padded_size, 128) + 256` is larger than `0x7FFFF` or if boot1 runs out of blocks, the attempt fails with error `-6`.

The pages go through msht like a instruciton pipeline: while the NAND engine reads one page, the previous page is corrected and decrypted in place and the page before that is hashed. All of the content is decrypted as one AES-128-CBC stream with the decrypted content key. The first AES command written to `0x0D020000` is `0x98000000 | (length / 16 - 1)` and every following one is `0x98001000 | (length / 16 - 1)`. The SHA-1 hash covers exactly the content size (not the padding to 16 bytes) and uses standard SHA-1 padding. If the hash does not match the TMD, the attempt fails with error `-7`.

### SHA-1

The SHA-1 engine only processes whole 64 byte blocks, so boot1 adds the padding itself. To finish a hash, it builds the last one or two blocks in MEM1 at `0x000A8000`: the leftover bytes, a `0x80` byte, zeros and the message length in bits. Only the low 32 bits of the length are written. The upper 32 bits are always zero.

### ECC correction

`ecc_correct` checks a 2048 byte page in four 512 byte chunks. For each chunk it compares the ECC word stored in the spare area at `0x30 + 4 * i` with the word the NAND engine calculated at `0x40 + 4 * i`:

```c
int ecc_correct(u8 *data, u8 *spare)
{
    for (int i = 0; i < 4; i++) {
        u32 stored   = read32(spare + 0x30 + 4 * i);
        u32 computed = read32(spare + 0x40 + 4 * i);
        if (stored == computed)
            continue;

        u32 diff = bswap32(stored) ^ bswap32(computed);
        if ((diff & (diff - 1)) == 0)
            continue;               // only one bit differs: the error is in the ECC itself

        if (((diff & 0xFFF) ^ (diff >> 16)) != 0xFFF)
            return -1;              // the data cannot be corrected

        u32 byte = (diff >> 19) & 0x1FF;
        u32 bit  = (diff >> 8) & 7;
        data[i * 512 + byte] ^= 1 << bit;
    }
    return 0;
}
```

## Engine handshake

Before every AES or SHA-1 command and after every NAND read or AES command, boot1 runs a handshake that its error message calls `ahbMemFlush`. It writes a mask to the 16 bit register at `0x0D8B4228` and then reads the 16 bit register at `0x0D8B422A` until it returns the same mask, calling `udelay(1)` between reads. When the register matches or after 1,000,000 failed reads, boot1 writes `0` back to `0x0D8B4228`.

| When                          | Mask |
| ----------------------------- | ---- |
| Before a SHA-1 or AES command | `1`  |
| After a NAND read             | `8`  |
| After an AES command          | `2`  |

If the register never matches, boot1 prints `ERROR: ahbMemFlush(0x%x) did not ack!` and carries on. The message goes out through ARM semihosting, never had to deal with this so take it with a grain of salt pls: a Thumb `SVC 0xAB` with `R0 = 4` (`SYS_WRITE0`) and `R1` pointing at the text. boot1 sends the text in pieces of up to 15 characters.

### Synchronization after a register read

Each acknowledgement poll goes through `memreg_read_sync(0x22A)`. This helper reads the 16 bit register at `0x0D8B422A`, calls `ahb_sync_dev(0)` and then returns the value it read before that call.

`ahb_sync_dev(0)` works on bit 15 of the 32 bit register at `0x0D8B0008`. Bit 0 is the least significant bit.

| Register     | Bit | Use by boot1                                                           |
| ------------ | --- | ---------------------------------------------------------------------- |
| `0x0D8B0008` | 15  | Skips the device 0 sequence when set. Otherwise pulsed as shown below. |

If bit 15 already reads as one, the call returns without writing the register. Otherwise boot1 makes four 32 bit writes based on the value it read: one with bit 15 clear, followed by three with bit 15 set. The other bits keep their values from that original read.

### Status wait before device synchronization

Before it submits SHA-1 input, boot1 calls `ahb_sync(5)`, which runs `ahb_sync_dev(5)` and then `ahb_sync_dev(0)`. Devices 2 through 10 share one branch of `ahb_sync_dev`. Each selects mask `1 << (device - 2)` in the 32 bit register at `0x0D8B0008`, so device 5 selects bit 3 (`0x00000008`). If the selected bit already reads as one, the call returns immediately.

Otherwise boot1 polls the low four bits of [`HW_BOOT0`](<index.md#hw_boot0>) at `0x0D80018C` while it changes `HW_SPARE0` at `0x0D800188` and several other control registers:

| Register                                         | Bits   | Use by boot1                                                                          |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------- |
| `HW_SPARE0` (`0x0D800188`)                       | 25     | Set before the second wait. Cleared during cleanup.                                   |
| `HW_SPARE0` (`0x0D800188`)                       | 16     | Set on every pass of the first wait while `HW_BOOT0[3:0]` is 9. Cleared afterwards.   |
| [`HW_BOOT0`](<index.md#hw_boot0>)                | `3:0`  | Polled until it leaves 9, then polled again after setup until it reaches 9.           |
| `0x0D800124`                                     | `10:6` | Set to 10 during setup and to 3 during cleanup. Bit 10 is clear in both values.       |
| `0x0D800134`                                     | 10     | Set before the second wait. Cleared during cleanup.                                   |
| `0x0D800100` through `0x0D800120`, every 4 bytes | 10     | Set in each register after the second wait. Cleared during cleanup.                   |
| `0x0D8B0008`                                     | `8:0`  | Devices 2 through 10 select bits 0 through 8. A set bit skips the sequence.           |
| `0x0D800214`                                     | `7:4`  | Tested by `mc_read` to decide whether it sets and later restores `0x0D800130`.        |
| `0x0D800130`                                     | 10     | Set by `mc_read` before four discarded reads of `0x0D800138` when that path is taken. |

All accesses in the sequence are 32 bits at Starlet physical addresses. `set32` and `clear32` each read the register fresh and write it back with only the given bits changed. `replace32` reads the register, clears the mask and inserts the given value:

```c
void ahb_sync_dev(u32 device)  // devices 2 through 10
{
    u32 mask = 1u << (device - 2);
    if ((mc_read(8) & mask) != 0)
        return;

    while ((read32(HW_BOOT0) & 0xF) == 9)
        set32(HW_SPARE0, 0x00010000);

    clear32(HW_SPARE0, 0x00010000);
    set32(HW_SPARE0, 0x02000000);
    replace32(0x0D800124, 0x000007C0, 0x00000280);
    set32(0x0D800134, 0x00000400);

    while ((read32(HW_BOOT0) & 0xF) != 9) {}

    for (u32 address = 0x0D800100; address <= 0x0D800120; address += 4)
        set32(address, 0x00000400);

    write32(0x0D8B0008, mc_read(8) & ~mask);
    write32(0x0D8B0008, mc_read(8) | mask);

    clear32(0x0D800134, 0x00000400);
    for (u32 address = 0x0D800100; address <= 0x0D800120; address += 4)
        clear32(address, 0x00000400);
    clear32(HW_SPARE0, 0x02000000);
    replace32(0x0D800124, 0x000007C0, 0x000000C0);
}
```

The first loop waits for `HW_BOOT0[3:0]` to leave 9 and the second waits for it to reach 9. Both compare against 9 for every device in this branch. Neither loop has a timeout or calls `udelay`. boot1 never writes `HW_BOOT0` during the sequence. The two writes to `0x0D8B0008` happen only after the second wait. The SHA-1 command is issued after `ahb_sync` returns.

Both writes to `0x0D800124` clear bit 10. The setup write puts 10 into bits `9:6` and the cleanup write puts 3 there. Cleanup clears the bits that setup set instead of restoring their entry values. It returns without polling `HW_BOOT0` again.

`mc_read(offset)` reads the word at `0x0D8B0000 | offset`. If bits `7:4` of `0x0D800214` read as zero on entry, it first saves `0x0D800130`, sets bit 10 there and reads `0x0D800138` four times, discarding the values. After reading the requested word, it reads `0x0D800214` twice. If bits `7:4` of the second read are zero, it writes the saved value back to `0x0D800130`. When the entry test found a nonzero field, nothing was saved and this restore writes zero.

### udelay

`udelay(n)` busy-waits on the counter at `0x0D800010`. It converts `n` to a number of counter ticks by adding shifted copies of `n`:

```c
u32 ticks = scale
    ? n + (n >> 1) + (n >> 2) + (n >> 3) + (n >> 6) + (n >> 8) + (n >> 9) + (n >> 10) + (n >> 12)
    : n + (n >> 2) + (n >> 6);
if (ticks < 2)
    ticks = 2;
```

`scale` is a word stored in boot1 at `0x0D404314` and its value is `1`. The wait handles the counter wrapping around.

## SEEPROM

boot1 reads the SEEPROM, a small serial EEPROM, by toggling GPIO lines in software:

| Register     | Bit | Use                                 |
| ------------ | --- | ----------------------------------- |
| `0x0D8000E0` | 10  | Chip select, high during a transfer |
| `0x0D8000E0` | 11  | Clock                               |
| `0x0D8000E0` | 12  | Data sent to the SEEPROM            |
| `0x0D8000E8` | 13  | Data received from the SEEPROM      |

For every bit, boot1 sets the clock low and chip select high, puts the next bit on the data line, calls `delay(125)`, sets the clock high and calls `delay(125)` again. Incoming bits are read at the end of that sequence, while the clock is still high. Bits are sent and received most significant bit first.

To read a 16 bit word, boot1 sends the 11 bits `0x600 + word_address`, receives 16 bits and then ends the transfer by clearing chip select and toggling the clock two more times.

### SEEPROM version record

The SEEPROM holds two copies of a 10 byte version record, at byte offsets `0x48` and `0x52`. All values are big-endian:

| Offset | Size | Contents                                                                          |
| ------ | ---- | --------------------------------------------------------------------------------- |
| `0x00` | 1    | Version byte 0, the lowest allowed value for TMD byte `0x18B`                     |
| `0x04` | 4    | Counter                                                                           |
| `0x08` | 2    | Checksum: the sum of the four 16 bit words at `0x00`-`0x07`, truncated to 16 bits |

A copy is valid when its checksum matches. Among the valid copies, boot1 uses the one with the highest counter. If neither copy is valid, the version check fails.

## Errors

When both attempts fail, the GPIO debug field alternates between the low byte of the error code and its complement.

| Code  | Shown           | Meaning                                                     |
| ----- | --------------- | ----------------------------------------------------------- |
| `-1`  | `0xFF` / `0x00` | A page has an error that ECC cannot correct                 |
| `-4`  | `0xFC` / `0x03` | No usable block between 1 and 7                             |
| `-5`  | `0xFB` / `0x04` | The header is invalid                                       |
| `-6`  | `0xFA` / `0x05` | The content is too large or boot1 ran out of blocks         |
| `-7`  | `0xF9` / `0x06` | The content hash does not match the TMD                     |
| `-8`  | `0xF8` / `0x07` | An issuer does not match or a signature check failed        |
| `-9`  | `0xF7` / `0x08` | A certificate name does not start with `CA`, `CP` or `XS`   |
| `-10` | `0xF6` / `0x09` | The TMD version is too old or the SEEPROM record is invalid |
| `-11` | `0xF5` / `0x0A` | The TMD title ID is not `00000001-00000001`                 |
