# Starlet

Shoutout to Zayd :)

## Memory Map

Addresses are Starlet physical addresses.

| Start        | End (inclusive) | Size                  | Mapping                                |
| ------------ | --------------- | --------------------- | -------------------------------------- |
| `0x00000000` | `0x017FFFFF`    | 24 MiB                | MEM1                                   |
| `0x10000000` | `0x13FFFFFF`    | 64 MiB                | MEM2 with configurable Broadway access |
| `0x0D400000` | `0x0D41FFFF`    | 128 KiB window        | SRAM/boot ROM mapping                  |
| `0xFFF00000` | `0xFFFDFFFF`    | Seven 128 KiB windows | Mirrors of the window at `0x0D400000`  |
| `0xFFFE0000` | `0xFFFFFFFF`    | 128 KiB window        | SRAM/boot ROM mapping                  |

### SRAM and boot ROM mapping

SRAM consists of a 64 KiB bank A and a 32 KiB bank B. The 8 KiB boot ROM repeats every `0x2000` bytes throughout the ranges where it is mapped. Two controls decide what appears in the windows. [`HW_SRNPROT[SM]`](#hw_srnprot) (`0x0D800060`) selects the bank arrangement and [`HW_BOOT0[12]`](#hw_boot0) (`0x0D80018C`) hides the boot ROM when set. Switching either control only changes the mapping. The SRAM contents stay where they are.

With the boot ROM enabled (`HW_BOOT0[12] = 0`):

| `SM` | Start        | End (inclusive) | Mapping  |
| ---- | ------------ | --------------- | -------- |
| 0    | `0x0D400000` | `0x0D40FFFF`    | SRAM A   |
| 0    | `0x0D410000` | `0x0D417FFF`    | SRAM B   |
| 0    | `0xFFFE0000` | `0xFFFEFFFF`    | SRAM A   |
| 0    | `0xFFFF0000` | `0xFFFFFFFF`    | Boot ROM |
| 1    | `0x0D400000` | `0x0D41FFFF`    | Boot ROM |
| 1    | `0xFFFE0000` | `0xFFFEFFFF`    | Boot ROM |
| 1    | `0xFFFF0000` | `0xFFFFFFFF`    | SRAM A   |

With the boot ROM disabled (`HW_BOOT0[12] = 1`), the windows at `0x0D400000` and `0xFFFE0000` share one arrangement. Offsets are relative to the start of either window:

| `SM` | Start offset | End offset (inclusive) | Mapping |
| ---- | ------------ | ---------------------- | ------- |
| 0    | `0x00000`    | `0x0FFFF`              | SRAM A  |
| 0    | `0x10000`    | `0x17FFF`              | SRAM B  |
| 1    | `0x00000`    | `0x07FFF`              | SRAM B  |
| 1    | `0x10000`    | `0x1FFFF`              | SRAM A  |

Each SRAM range maps its bank starting at byte zero. The seven windows from `0xFFF00000` through `0xFFFDFFFF` mirror the window at `0x0D400000` in every configuration.

## SRAM control

| Starlet physical address | Width   | Name         | Purpose                 |
| ------------------------ | ------- | ------------ | ----------------------- |
| `0x0D800060`             | 32 bits | `HW_SRNPROT` | SRAM access and mapping |
| `0x0D80018C`             | 32 bits | `HW_BOOT0`   | Boot ROM visibility     |

### HW_SRNPROT

| Bits | Name           | Description                                                    |
| ---- | -------------- | -------------------------------------------------------------- |
| 5    | `SM` / `IOUEN` | Selects the [SRAM/ROM arrangement](#sram-and-boot-rom-mapping) |
| 3    | `U3` / `AHPEN` | Enables Broadway access to SRAM                                |
| 2    | `C` / `FLAEN`  | Enables NAND engine access to SRAM                             |
| 1    | `B` / `SHAEN`  | Enables SHA-1 engine access to SRAM                            |
| 0    | `A` / `AESEN`  | Enables AES engine access to SRAM                              |

### HW_BOOT0

| Bits  | Description                                                    |
| ----- | -------------------------------------------------------------- |
| 12    | Disables the boot ROM mappings when set.                       |
| `3:0` | Polled by boot1 for the value 9 during device synchronization. |

While bit 12 is set, the ranges that would otherwise show the boot ROM expose SRAM according to `HW_SRNPROT[SM]`, as listed in [SRAM and boot ROM mapping](#sram-and-boot-rom-mapping).

boot1 polls bits `3:0` while it changes `HW_SPARE0` (`0x0D800188`). [Status wait before device synchronization](<boot1.md#status-wait-before-device-synchronization>) describes the firmware sequence.

## Timer alarm

| Physical address | Width   | Access | Name       | Purpose        |
| ---------------- | ------- | ------ | ---------- | -------------- |
| `0x0D800010`     | 32 bits | R      | `HW_TIMER` | Timer counter  |
| `0x0D800014`     | 32 bits | W      | `HW_ALARM` | Alarm deadline |

Software reads the counter and writes a future counter value to `HW_ALARM` to request a timer interrupt. The timer interrupt uses bit 0 of [`HW_ARMIRQFLAG` and `HW_ARMIRQMASK`](#arm-interrupts). Writing `0x00000001` to `HW_ARMIRQFLAG` acknowledges it. A subsequent alarm is scheduled by writing another deadline.

The [IOS alarm programming sequence](<ios/index.md#timer-alarm>) clamps short delays before adding them to the counter.

## ARM interrupts

Addresses are Starlet physical addresses.

| Address      | Width   | Access | Name            | Purpose                |
| ------------ | ------- | ------ | --------------- | ---------------------- |
| `0x0D800038` | 32 bits | R/W    | `HW_ARMIRQFLAG` | Pending ARM interrupts |
| `0x0D80003C` | 32 bits | R/W    | `HW_ARMIRQMASK` | ARM interrupt mask     |

### HW_ARMIRQFLAG - `0x0D800038` (32 bits, R/W)

| Bit | Name  | Description                        |
| --- | ----- | ---------------------------------- |
| 0   | Timer | Pending timer alarm interrupt      |
| 1   | NAND  | Pending NAND completion interrupt  |
| 2   | AES   | Pending AES completion interrupt   |
| 3   | SHA-1 | Pending SHA-1 completion interrupt |
| 7   | SDHC  | Pending front SD slot interrupt    |
| 31  | IPC   | Pending Broadway IPC interrupt     |

### HW_ARMIRQMASK - `0x0D80003C` (32 bits, R/W)

| Bit | Name  | Description                    |
| --- | ----- | ------------------------------ |
| 0   | Timer | Mask bit for timer alarms      |
| 1   | NAND  | Mask bit for NAND completion   |
| 2   | AES   | Mask bit for AES completion    |
| 3   | SHA-1 | Mask bit for SHA-1 completion  |
| 7   | SDHC  | Mask bit for the front SD slot |
| 31  | IPC   | Mask bit for Broadway IPC      |

The boot2 kernel's `irq_handler` (`0xFFFF1F14`) reads `HW_ARMIRQFLAG`, ANDs it with `HW_ARMIRQMASK` and handles each interrupt whose bit is set in the result. It acknowledges an interrupt by writing a value with only that interrupt's bit set to `HW_ARMIRQFLAG`.

## OTP

OTP (one-time programmable memory) stores 128 bytes inside Hollywood. It is programmed during manufacturing and cannot be erased or rewritten. Its contents include the expected boot1 hash and cryptographic keys (TODO: anything else?).

The first 20 bytes hold the expected boot1 hash, see [boot0](<boot0.md#loading-and-verification>) reads this field during verification.

## Boot sequence

1. [boot0](<boot0.md>) decrypts and verifies boot1
2. [boot1](<boot1.md>) loads, decrypts and verifies boot2
3. [boot2](<boot2.md>) hands off into IOS
4. [IOS](<ios/index.md>) starts its kernel and service modules

[BootMii](<bootmii.md>) runs its own Starlet firmware, MINI, in place of IOS.
