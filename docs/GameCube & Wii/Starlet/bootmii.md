# BootMii

BootMii consists of the MINI firmware on Starlet and a graphical interface on Broadway. [HackMii Installer](<hackmii.md#sd-files>) prepares their SD files.

## USB Gecko detection

MINI's `gecko_init` (`0xFFFF1728`) clears the EXI channel status registers at `0x0D806800`, `0x0D806814` and `0x0D806828` then calls `gecko_isalive` (`0xFFFF165C`). The detection routine probes EXI channel 1 with 32 bit accesses:

| Physical address | Name        | Use                                                        |
| ---------------- | ----------- | ---------------------------------------------------------- |
| `0x0D806814`     | `EXI1_CSR`  | Writes `0xD0` to select the device and zero to deselect it |
| `0x0D806820`     | `EXI1_CR`   | Starts a transfer and polls for completion                 |
| `0x0D806824`     | `EXI1_DATA` | Supplies the command and reads the response                |

Each transfer starts with a write to `EXI1_CR`. The routine then waits for the transfer start bit to clear before it starts the next transfer or reads the response:

| Bit | Name           | Firmware use       |
| --- | -------------- | ------------------ |
| 0   | Transfer start | Polled until clear |

The routine first writes zero to `EXI1_DATA` and `0x19` to `EXI1_CR`. Once that transfer completes it writes `0x39` and waits again. A nonzero response rejects the device. After a zero response it sends `0x90000000` with control value `0x19` and requires `0x0470` in the upper 16 bits of the response.

None of these polling loops has a timeout. If the device is rejected, the routine returns without enabling the USB Gecko console.

## SD card startup

MINI's `sdhc_init` (`0xFFFF3F24`) enables ARM interrupt 7 and initializes the front SD slot at physical address `0x0D070000`. `sdhc_host_found` (`0xFFFF3E3C`) resets the host and reads its capabilities. The base clock must be nonzero and between 10 MHz and 63 MHz. DMA is enabled when the host reports SDMA support.

| Register offset | Bits | Field         | Firmware use                                  |
| --------------- | ---- | ------------- | --------------------------------------------- |
| `0x24`          | 16   | Card inserted | Checked for an inserted card before discovery |
| `0x40`          | 13:8 | Base clock    | Read in MHz and converted to kHz              |
| `0x40`          | 22   | SDMA support  | Enables DMA transfers when set                |

`sdhc_start_command` (`0xFFFF3AF4`) waits until the command path is free before writing the argument and the transfer command. For a data transfer it also programs the DMA address and the block size and count. `sdhc_exec_command` (`0xFFFF3CC4`) waits for the command to complete and copies the response before it handles data completion.

`sdhc_transfer_data` (`0xFFFF3A38`) waits for either transfer complete or a DMA boundary interrupt. At a DMA boundary it reads the DMA address register at offset `0x00` and writes the same value back to resume the transfer. Transfer complete ends the wait.

| Normal interrupt bit | Meaning           | Firmware action                     |
| -------------------- | ----------------- | ----------------------------------- |
| 0                    | Command complete  | Reads the command response          |
| 1                    | Transfer complete | Finishes the data transfer          |
| 3                    | DMA boundary      | Writes the current DMA address back |

## Idle wait

MINI's `ipc_process_slow` (`0xFFFF05F8`) processes queued IPC requests. Once the queue is empty it saves the interrupt mask and masks IRQ and FIQ through `irq_kill` (`0xFFFF49A8`). It checks the queue once more and then executes wait-for-interrupt. After waking up it restores the saved mask through `irq_restore` (`0xFFFF49BC`).

Checking the queue again with interrupts masked closes the window in which an interrupt could fill the queue between the empty check and the wait. For this to work, a pending interrupt has to wake the CPU from the wait even while IRQ and FIQ are masked. The exception itself is taken once the mask is restored.

## PPC payload unpacking

The PPC loader's `unpack_and_boot` (`0x9001040C`) derives an AES key from its own code and a 256 byte scratch area at `0xD0080000`. It fills the scratch area with uncached byte stores and mixes the resulting bytes into the key, so the derived key depends on the [uncached byte store behavior](<../Memory.md#uncached-byte-stores>).

The loader then decrypts its compressed payload in place and decompresses the GUI ELF to `0x90100000`. It repeats the code check before loading the ELF and again before entering it. If decompression fails, the loader loops forever toggling the disc slot light.

## Broadway register access

The GUI's `ipc_init` (`0x8000A9E4`) reads the pointer to MINI's IPC information header from `0xD3FFFFFC`. It only uses the shared queues if the header contains the three byte magic `IPC` and protocol version 1. The GUI reaches the IPC registers through the `0xCD800000` window:

| Broadway address | Physical address | Register        |
| ---------------- | ---------------- | --------------- |
| `0xCD800000`     | `0x0D800000`     | `PPCMSG`        |
| `0xCD800004`     | `0x0D800004`     | `PPCCTRL`       |
| `0xCD800008`     | `0x0D800008`     | `ARMMSG`        |
| `0xCD800030`     | `0x0D800030`     | `HW_PPCIRQFLAG` |
| `0xCD800034`     | `0x0D800034`     | `HW_PPCIRQMASK` |

`ipc_post` (`0x8000A6E8`) fills in a 32 byte request in the input queue and flushes it from the data cache. It advances the input tail, wrapping at the queue capacity, writes the new tail to the low 16 bits of `PPCMSG` and writes `1` to `PPCCTRL` to notify MINI.

| `PPCMSG` bits | Meaning in MINI's queue protocol |
| ------------- | -------------------------------- |
| 31:16         | Output queue head                |
| 15:0          | Input queue tail                 |

MINI passes queue indices through the mailbox registers, unlike [IOS](<ios/index.md#mailboxes-and-control-flags>), which passes request and reply pointers.

The GUI's `gecko_init` (`0x800090E8`) probes EXI channel 1 through `0xCD806814`, `0xCD806820` and `0xCD806824`. These are the same channel registers that MINI's detection routine uses.

## Launching installed titles

The GUI's `launch_menu_title` (`0x8000E46C`) picks the title ID for the Wii or [Homebrew Channel](<homebrew-channel.md>) icon. `boot_title` (`0x8000B2C8`) then sends MINI request `0x00050000` with the high and low words of the title ID as its two arguments.

| Menu item        | Title ID            |
| ---------------- | ------------------- |
| Wii              | `00000001-00000002` |
| Homebrew Channel | `00010001-4C554C5A` |

MINI's `boot2_ipc` (`0xFFFF5CA8`) replies with the selected boot2 copy and waits for Broadway to consume the reply before it prepares the launch. If boot2 initialization failed, it replies with `-1` instead.

`boot2_run` (`0xFFFF5B40`) decrypts boot2 to `0x11000000`. For any title other than the System Menu it replaces boot2's default title ID and requires exactly one matching patch location. It writes `0x42` to the payload header's argument at `0x1100000C` and returns the entry address, which is the payload base plus the header size. With a 16 byte header the entry is `0x11000010`.

MINI shuts down its IPC service, interrupts and memory translation before entering boot2. From there boot2 launches IOS and the title. Selecting either icon therefore exits MINI instead of running the title alongside it.
