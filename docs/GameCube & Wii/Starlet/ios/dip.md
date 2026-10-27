# DIP

## System Menu disc detection

The Wii has a slot-loading drive, but the Disc Interface still calls its media state register and related commands "cover". Disc insertion and removal are reported through this interface.

The System Menu accesses the drive through `/dev/di`. To recognize an inserted disc and show its banner in the Disc Channel, it has to check the media state and read from the disc. For a Wii disc with update and game partitions, System Menu v513 makes these main requests:

1. Poll the cover register with ioctl `0x7A` to detect the disc. Reading the status and acknowledging an interrupt are separate [cover commands](<#cover-commands>).
2. Request drive information with ioctl `0x12` and read the disc ID with ioctl `0x70`.
3. Read disc metadata such as the partition table and region information with the unencrypted read ioctl `0x8D`.
4. Open the update partition with ioctlv `0x8B`, read from it with ioctl `0x71` then close it with ioctl `0x8C`.
5. Open the game partition with ioctlv `0x8B` and read from it with ioctl `0x71`. These reads supply the data the System Menu uses to populate the Disc Channel and show its banner before the user selects Start.

Opening a partition returns its title metadata and makes it the target of subsequent partition reads. These reads must come from the currently open partition, not always from the game partition. Unencrypted reads take offsets relative to the start of the disc while partition reads take offsets into the open partition's decrypted data.

[Drive-register initialization](<#status-initialization>) and [cover interrupt handling](<#disc-cover-handling>) are still required, but a cover status response alone does not supply the disc contents the Disc Channel needs.

## Partition verification

`open_partition` (`0x20202F34`) only works after the disc ID has been read, because that read sets up the encryption and hash flags it uses. It also refuses to open a second partition while one is already open.

Opening a partition reads the partition header, title metadata (TMD) and certificates from the disc. `verify_partition` (`0x20202D14`) then passes the ticket, TMD and certificate chain to ES through ioctlv `0x1C`, which takes four input vectors and two output vectors:

| Vector | Direction | Contents                                        |
| ------ | --------- | ----------------------------------------------- |
| 0      | Input     | Certificate chain                               |
| 1      | Input     | Certificate revocation list, empty in this path |
| 2      | Input     | 676 byte ticket                                 |
| 3      | Input     | TMD                                             |
| 4      | Output    | 4 byte key handle                               |
| 5      | Output    | 20 byte hash for each TMD content               |

ES reports its result separately from DIP's. A nonzero ES result fails the open. Successful verification is also what sets up the disc's title context in ES, so returning a TMD without going through ES is not enough.

For an encrypted partition, `verify_partition_hashes` (`0x20202BF8`) then reads the `0x18000` byte H3 table and checks its SHA-1 digest against the content hashes from ES. The partition is only marked open once this check passes. The partition data address must be aligned to `0x8000` bytes.

## Request dispatch

`dvd_driver` (`0x2020062C`) registers `/dev/di`. It passes ioctl arguments to `di_ioctl` (`0x20200400`) and vector arguments to `di_ioctlv` (`0x20200284`). After the handler returns, the driver passes its result to `reply_request` (`0x20205E88`).

Both argument structures begin at byte offset `0x0C` in the IOS request. Each field is a 32 bit big endian value, and pointers are addresses in the driver's address space.

| Ioctl argument offset | Field                         |
| --------------------- | ----------------------------- |
| `0x00`                | Command                       |
| `0x04`                | Input buffer pointer          |
| `0x08`                | Input buffer length in bytes  |
| `0x0C`                | Output buffer pointer         |
| `0x10`                | Output buffer length in bytes |

| Ioctlv argument offset | Field                |
| ---------------------- | -------------------- |
| `0x00`                 | Command              |
| `0x04`                 | Input vector count   |
| `0x08`                 | Output vector count  |
| `0x0C`                 | Vector array pointer |

Each vector holds a 32 bit buffer pointer followed by a 32 bit length in bytes. Every ioctl except command `0x8E` requires a 32 byte input buffer. Command `0x8B` opens a partition and must be sent through ioctlv. Sending it through ioctl returns `0x20`.

### Cover commands

| Ioctl  | Operation                                                                 | Result                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x79` | Wait for the cover to close.                                              | Returns `4` after the wait completes.                                                                                                                                                     |
| `0x7A` | Read `DICVR` into the first output word.                                  | Returns `1` on success or `0x20` if the output is shorter than 4 bytes.                                                                                                                   |
| `0x85` | Disable cover interrupts without acknowledging a pending cover interrupt. | Returns `1`.                                                                                                                                                                              |
| `0x86` | Acknowledge the cover interrupt.                                          | Returns `1`.                                                                                                                                                                              |
| `0x87` | Return without accessing the drive.                                       | Returns `1`.                                                                                                                                                                              |
| `0x88` | Read cover readiness into the first output word.                          | Writes `0` during the first 100 milliseconds of a pending reset, `1` for an open cover or `2` for a closed cover. Returns `1` on success or `0x20` if the output is shorter than 4 bytes. |
| `0x89` | Enable cover interrupts without acknowledging a pending cover interrupt.  | Returns `1`.                                                                                                                                                                              |

## Disc cover handling

DIP accesses the Disc Interface cover register through virtual address `0x0D006004`, mapped to physical address `0x0D806004`.

| Address      | Width   | Firmware access | Name    | Purpose                                 |
| ------------ | ------- | --------------- | ------- | --------------------------------------- |
| `0x0D006004` | 32 bits | Read/write      | `DICVR` | Cover state and cover interrupt control |

### DICVR - 0x0D006004 (32 bits)

| Bits | Field                  | Firmware use                                                            |
| ---- | ---------------------- | ----------------------------------------------------------------------- |
| `0`  | Cover state            | Require `0` before completing a wait for cover closure.                 |
| `1`  | Cover interrupt enable | Set before waiting for closure and clear after the wait completes.      |
| `2`  | Cover interrupt status | Test when processing an interrupt message and write `1` to acknowledge. |

`wait_for_cover_close` (`0x20200B98`) enables cover interrupts then waits on its message queue. It ignores messages of type `10` and processes interrupt messages of type `11`. A cover interrupt ends the wait only when the reset delay has expired and Cover State is clear. The routine acknowledges the cover interrupt even when those conditions do not allow it to finish.

`init_driver_events` (`0x20200074`) registers IOS event `18` with the transaction queue, using a message whose first 32 bit word is `11`. Both the cover wait and the drive command completion path receive messages from this queue.

`enable_cover_interrupt` (`0x202009C0`) reads `DICVR`, clears bits `2:1` in the value then sets bit `1` before writing it back. `disable_cover_interrupt` (`0x202009D4`) clears bits `2:1` in the read value before writing it back. Both avoid acknowledging an existing cover interrupt as a side effect of changing its enable. `acknowledge_cover` (`0x202009B0`) reads the register then writes the value with bit `2` set.

## Status initialization

`init_drive_registers` (`0x20200D1C`) acknowledges any pending transfer-complete and device-error status before enabling the corresponding interrupts. It polls the transfer-complete interrupt enable until the bit reads back as set. It then enables the device-error interrupt and disables the cover interrupt. It also checks that both acknowledged status fields are clear.

### DISR - 0x0D006000 (32 bits)

This virtual address maps to physical address `0x0D806000`.

| Bits | Field                              | Firmware use                                                               |
| ---- | ---------------------------------- | -------------------------------------------------------------------------- |
| `1`  | Device-error interrupt enable      | Set during drive-register initialization.                                  |
| `2`  | Device-error status                | Test for a drive error and write `1` to acknowledge it.                    |
| `3`  | Transfer-complete interrupt enable | Set during drive-register initialization and poll until it reads back set. |
| `4`  | Transfer-complete status           | Test for command completion and write `1` to acknowledge it.               |

`clear_device_error` (`0x20200B80`) acknowledges the device error while preserving the interrupt enables.

## Raw disc transfers

`handle_command` (`0x20200EF8`) programs raw reads through these 32 bit registers, which map to physical `0x0D806008` through `0x0D80601C`:

| Virtual address | Purpose          | Raw-read value                                              |
| --------------- | ---------------- | ----------------------------------------------------------- |
| `0x0D006008`    | Command word 0   | `0xA8000000` for a raw read or `0xA8000040` for the disc ID |
| `0x0D00600C`    | Command word 1   | Disc offset in units of 4 bytes, zero for the disc ID       |
| `0x0D006010`    | Command word 2   | Transfer length in bytes                                    |
| `0x0D006014`    | DMA destination  | Output buffer address                                       |
| `0x0D006018`    | DMA length       | Transfer length in bytes                                    |
| `0x0D00601C`    | Transfer control | `3` to start the DMA read                                   |

A disc ID read transfers 32 bytes. Raw reads need a 32 byte aligned destination and a length that is a multiple of 32. `start_timed_transfer` (`0x20200E4C`) expects the transfer-complete interrupt to be enabled when it writes transfer control. It starts a command timeout timer right after that write.

The driver then waits for messages on its transaction queue. When the transfer-complete interrupt arrives, it stops the timer, acknowledges the status and checks for a device error before reporting success. The data transfer alone does not complete a read. The driver also needs that interrupt message.
