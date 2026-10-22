# Starlet

Shoutout to Zayd :)

## Memory Map

| Start        | End          | Size           | Mapping                                    |
| ------------ | ------------ | -------------- | ------------------------------------------ |
| `0x00000000` | `0x017FFFFF` | 24 MiB         | MEM1                                       |
| `0x10000000` | `0x13FFFFFF` | 64 MiB         | MEM2; Broadway access can be restricted    |
| `0x0D400000` | `0x0D41FFFF` | 128 KiB window | SRAM/boot ROM mapping; not 128 KiB of SRAM |
| `0xFFFE0000` | `0xFFFFFFFF` | 128 KiB window | SRAM/boot ROM mapping                      |

With boot ROM enabled and [`HW_SRNPROT[SM]`](#hw_srnprot) = `0`:

| Starlet address | Mapping               | Use                                  |
| --------------- | --------------------- | ------------------------------------ |
| `0xFFFF0000`    | Boot ROM              | boot0 execution                      |
| `0x0D400000`    | SRAM                  | boot1 load destination and execution |
| `0xFFF00000`    | Alias of `0x0D400000` | boot1 execution                      |

## SRAM control

| Starlet physical address | Width   | Name         | Purpose                 |
| ------------------------ | ------- | ------------ | ----------------------- |
| `0x0D800060`             | 32 bits | `HW_SRNPROT` | SRAM access and mapping |

### HW_SRNPROT

| Bits | Name           | Description                         |
| ---- | -------------- | ----------------------------------- |
| 5    | `SM` / `IOUEN` | Selects the SRAM/ROM mapping        |
| 3    | `U3` / `AHPEN` | Enables Broadway access to SRAM     |
| 2    | `C` / `FLAEN`  | Enables NAND engine access to SRAM  |
| 1    | `B` / `SHAEN`  | Enables SHA-1 engine access to SRAM |
| 0    | `A` / `AESEN`  | Enables AES engine access to SRAM   |

## OTP

OTP (one-time programmable memory) stores 128 bytes inside Hollywood. It is programmed during manufacturing and cannot be erased or rewritten. Its contents include the expected boot1 hash and cryptographic keys (TODO: anything else?).

The first 20 bytes hold the expected boot1 hash, see [boot0](<Starlet/boot0.md#loading-and-verification>) reads this field during verification.

## Boot sequence

1. [boot0](<Starlet/boot0.md>) decrypts and verifies boot1
2. boot1 loads, decrypts and verifies boot2
3. boot2 hands off into IOS
4. IOS does whatever bullshit for System Menu, probably also EXI stuff
