# WL

## SDIO initialization

The WL wireless driver talks to the internal Wi-Fi chip through the SDIO host controller at `0x0D080000`. In SDIO terms the chip is the card, so card selection, card interrupts and Card Inserted on this page all refer to it rather than the removable SD card.

`init_sdio_card` (`0x13F1DD90`) reads the 32 bit Present State register at `0x0D080024` and checks Card Inserted before continuing initialization.

| Bits | Field         | Meaning                                                       |
| ---- | ------------- | ------------------------------------------------------------- |
| `16` | Card Inserted | `1` when the Wi-Fi chip is present. `0` stops initialization. |

When Card Inserted is clear, the routine returns `1`. `attach_sdio_host` (`0x13F1E9D4`) retries initialization once. If both attempts fail, it releases the host object and returns a null pointer. This failure propagates through the attachment routines.

`wireless_worker` (`0x13F0A4E0`) does not check the returned driver pointer before reading its message queue handle at offset `0x1C8`. It calls `receive_message` (`0x13F2869C`) with that handle and retries immediately whenever the call returns a nonzero result.


## Host setup

Initialization checks the Capabilities register at `0x0D080040`:

| Bits  | Field                   | Firmware use                                                    |
| ----- | ----------------------- | --------------------------------------------------------------- |
| `5:0` | Timeout Clock Frequency | Must equal `48` for clock setup to proceed.                     |
| `22`  | SDMA Support            | Must be set for initialization to proceed.                      |
| `24`  | 3.3 V Support           | Selects the 3.3 V power encoding when set.                      |
| `25`  | 3.0 V Support           | Selects the 3.0 V power encoding when bit 24 is clear.          |
| `26`  | 1.8 V Support           | Selects the 1.8 V power encoding when bits 24 and 25 are clear. |

`reset_host` (`0x13F1D534`) requests a card reset with CMD52, writing `8` to function 0 register `6`. It then writes all three host reset bits and polls until they clear.

The word at `0x0D08002C` contains the clock controls and reset requests used by WL:

| Bits    | Field                       | Firmware use                                     |
| ------- | --------------------------- | ------------------------------------------------ |
| `0`     | Internal Clock Enable       | Set before polling clock stability.              |
| `1`     | Internal Clock Stable       | Polled until set before enabling the card clock. |
| `2`     | SD Clock Enable             | Set after the internal clock becomes stable.     |
| `19:16` | Data Timeout Counter Value  | Written with `14` after card selection.          |
| `15:8`  | SDCLK Frequency Select      | Written with the clock divider encoding.         |
| `24`    | Software Reset For All      | Set during host reset.                           |
| `25`    | Software Reset For CMD Line | Set during host reset.                           |
| `26`    | Software Reset For DAT Line | Set during host reset.                           |

After enabling the clock, WL selects a supported voltage and enables bus power through the word at `0x0D080028`:

| Bits   | Field                 | Meaning                                                     |
| ------ | --------------------- | ----------------------------------------------------------- |
| `1`    | Data Transfer Width   | Set for a 4 bit bus.                                        |
| `8`    | SD Bus Power          | Set to enable power.                                        |
| `11:9` | SD Bus Voltage Select | `5` selects 1.8 V, `6` selects 3.0 V and `7` selects 3.3 V. |

It then calls `delay` (`0x13F0AA28`) for 50,000 microseconds. This delay creates a timer and waits for a message on its completion queue before initialization continues.

## Command completion and initialization failure

After the power delay, initialization submits CMD5 with argument zero through `send_command` (`0x13F1CF58`). This writes `0x05020000` to `0x0D08000C` and polls the lower halfword of the interrupt status register at `0x0D080030`.

| Bits    | Field              | Firmware use                                                  |
| ------- | ------------------ | ------------------------------------------------------------- |
| `1`     | Transfer Complete  | Wait for it after writing CMD53 data.                         |
| `4`     | Buffer Write Ready | Wait for it before writing CMD53 data to `0x0D080020`.        |
| `5`     | Buffer Read Ready  | Wait for it before reading CMD53 data from `0x0D080020`.      |
| `0`     | Command completion | Wait for it to become set then acknowledge it by writing `1`. |
| `31:16` | Error status       | Any nonzero value makes the completed command fail.           |

The polling counter starts at 5000 and is decremented after each read. If it reaches zero, the routine requests a command-line reset through the [clock and reset register](#host-setup) and returns `1`. A command timeout makes card initialization fail. The attachment routine retries initialization once before returning a null pointer.

After completion, the routine checks error status. A nonzero error status causes it to return `1`. With no error, `probe_card` (`0x13F1DC8C`) reads the CMD5 response. A zero response causes another CMD5 attempt. After 200 unsuccessful attempts, the probe returns `1` and initialization fails.

The worker's unchecked driver pointer then causes the [receive loop](#sdio-initialization) to use a queue handle read from address `0x000001C8`. If that handle is rejected, the worker immediately retries the receive call without blocking.

### CMD5 response

The CMD5 response is read from `0x0D080010`. The probe and initialization routines use these fields:

| Bits    | Field               | Firmware use                                                    |
| ------- | ------------------- | --------------------------------------------------------------- |
| `31`    | Ready               | Repeat CMD5 while clear. Return success when set.               |
| `30:28` | I/O function count  | Require a nonzero count before continuing initialization.       |
| `21:20` | Voltage window bits | If either is set, submit CMD5 again with argument `0x00FFF000`. |

After the probe succeeds and the function count is nonzero, initialization proceeds to CMD3 with argument zero.

### CMD3 response

CMD3 publishes the card's relative address in its R6 response. WL submits it by writing `0x03020000` to `0x0D08000C` with argument zero. After command completion, it reads the response from `0x0D080010` and checks these fields:

| Bits    | Field                 | Firmware use                                                           |
| ------- | --------------------- | ---------------------------------------------------------------------- |
| `31:16` | Relative card address | Save this value and use it in the upper halfword of the CMD7 argument. |
| `15`    | Command CRC error     | Fail initialization when set.                                          |
| `14`    | Illegal command       | Fail initialization when set.                                          |
| `13`    | Error                 | Fail initialization when set.                                          |

When the error fields are clear, initialization sends CMD7 to select the published address.

### CMD7 response

WL selects the card by writing `0x071A0000` to `0x0D08000C` with the relative card address in the upper halfword of the argument. After completion, it requires the response at `0x0D080010` to equal `0x00001E00`. Any other value makes initialization fail.

| Bits   | Field         | Required value                    |
| ------ | ------------- | --------------------------------- |
| `12:9` | Current state | `15`, indicating an I/O-only card |

The comparison covers the entire response word, so every bit outside the current-state field must be clear.

### CMD52 register access

`read_card` (`0x13F1D620`) uses CMD52 for single byte reads and accesses to function 0. `write_card` (`0x13F1D3AC`) uses CMD52 for the corresponding writes. The host command word is `0x341A0000` after card selection. The argument at `0x0D080008` has these fields:

| Bits    | Field            | Meaning                                                                           |
| ------- | ---------------- | --------------------------------------------------------------------------------- |
| `31`    | Write            | `1` writes a byte. `0` reads a byte.                                              |
| `30:28` | Function         | Selects the I/O function.                                                         |
| `27`    | Read after write | Requests the register value after a write. WL clears this field in these helpers. |
| `25:9`  | Register address | Selects the byte within the function.                                             |
| `7:0`   | Data             | Byte to write.                                                                    |

The read helper takes the returned byte from bits `7:0` of the response at `0x0D080010`.

After CMD7 succeeds, initialization performs these accesses through function 0:

1. `read_cis_pointer` (`0x13F1DD10`) reads four bytes starting at `0x09` for the common Card Information Structure (CIS) pointer. It repeats this at `function * 0x100 + 0x09` for each reported function. It interprets the bytes in little endian order and retains the low 17 bits.
2. It writes `0x02` to I/O Enable at `0x02` to enable function 1.
3. For a 4 bit bus, it reads Bus Interface Control at `0x07`, replaces the width field with `2` and writes it back. It also sets Data Transfer Width in the host register.
4. `set_block_size` (`0x13F1CEEC`) writes the low and high bytes of function 1's block size to `0x110` and `0x111`. Initialization selects 64 bytes.
5. With one reported function, it writes `0x03` to Interrupt Enable at `0x04`.

| Function 0 address | Bits  | Field                       | Value used during initialization |
| ------------------ | ----- | --------------------------- | -------------------------------- |
| `0x02`             | `1`   | Function 1 enable           | `1`                              |
| `0x04`             | `1`   | Function 1 interrupt enable | `1`                              |
| `0x04`             | `0`   | Master interrupt enable     | `1`                              |
| `0x07`             | `1:0` | Bus width                   | `2` selects 4 bits.              |

### CMD53 data reads

For reads larger than one byte from a nonzero function, `read_card` submits CMD53 in byte mode with address increment enabled. The argument contains:

| Bits    | Field             | Firmware use                   |
| ------- | ----------------- | ------------------------------ |
| `31`    | Write             | Clear for reads.               |
| `30:28` | Function          | Select the requested function. |
| `27`    | Block mode        | Clear for byte mode.           |
| `26`    | Address increment | Set.                           |
| `25:9`  | Register address  | Select the first byte.         |
| `8:0`   | Count             | Requested byte count.          |

For a 4 byte read, the host block size is `4` and the block count is `1` in the low and high halfwords of `0x0D080004`. The host command word is `0x353A0010`.

After command completion, the polling path waits for Buffer Read Ready in the [interrupt status register](#command-completion-and-initialization-failure). It uses a counter initialized to 5000 and returns `1` if that counter expires. Once ready, it reads the word at `0x0D080020`. It then reads normal interrupt status and acknowledges the set flags except Card Interrupt.

| Bits | Field          | Firmware use                                         |
| ---- | -------------- | ---------------------------------------------------- |
| `8`  | Card Interrupt | Excluded from the acknowledgement after a data read. |

### CMD53 data writes

For writes larger than one byte to a nonzero function, `write_card` submits CMD53 with the same byte count and address fields as a read. It sets the Write field. For a 4 byte write, the host command word is `0x353A0000`.

After command completion, the polling path waits for Buffer Write Ready. It uses a counter initialized to 5000 and returns `1` if that counter expires. It acknowledges Buffer Write Ready before writing the data at `0x0D080020`. A 2 byte write uses the low halfword of that register. `write_host_halfword` (`0x13F1CB18`) does this as a 32 bit read-modify-write: it reads Buffer Data, replaces the low 16 bits and writes the whole word back. Buffer Data is therefore read in the middle of a write transfer.

The routine then polls Transfer Complete with another counter initialized to 5000. It leaves this loop when completion arrives or the counter expires. It acknowledges the set normal status flags except Card Interrupt and returns `0`, including when this second counter expires.

### Backplane access helpers

`read_backplane` (`0x13F1C8C4`) and `write_backplane` (`0x13F1C958`) subtract `0x18000000` from the chip address and access SDIO function 1 through `transfer_card` (`0x13F1D7AC`). A successful read returns the low 8, 16 or 32 bits according to the requested size. A failed read returns `0xFFFFFFFF`. The write helper returns `0` on success or `-1` on failure.

For CMD53 accesses, the card helpers store the transfer size at byte offset `0x64` in the host object. The byte at `0x3A` selects polling. With polling enabled, a successful read stores its result as a 32 bit word at the supplied output pointer. A 16 bit result occupies the low halfword of that word.

`transfer_card` reverses the four bytes of the data word for chip addresses `0x18001304`, `0x1800130C`, `0x18001314`, `0x1800131C`, `0x18001324`, `0x1800132C`, `0x18001334`, `0x1800133C`, `0x18001344`, `0x1800134C`, `0x18001354` and `0x1800135C`. It changes the caller's data word in place before a write or after a read.

### Card interrupt masking

`begin_card_access` (`0x13F1CE48`) masks the card interrupt then increments the host object's access depth. `end_card_access` (`0x13F1CE70`) decrements the depth. If the result is zero and interrupts are enabled in the host object, it unmasks the card interrupt.

The host object uses native big endian fields:

| Byte offset | Size    | Field                                                                      |
| ----------- | ------- | -------------------------------------------------------------------------- |
| `0x0C`      | 4 bytes | Virtual address of the host register block                                 |
| `0x10`      | 4 bytes | Access depth                                                               |
| `0x14`      | 1 byte  | Nonzero requests interrupt unmasking when the access depth returns to zero |
| `0x28`      | 2 bytes | Normal interrupt signal mask                                               |
| `0x3A`      | 1 byte  | Nonzero selects polling for command and data completion                    |
| `0x3D`      | 1 byte  | Nonzero enables the mask/unmask register writes                            |
| `0x64`      | 4 bytes | Transfer size in bytes                                                     |

`mask_card_interrupt` (`0x13F1CC0C`) and `unmask_card_interrupt` (`0x13F1CBE8`) return without changing the mask when the byte at `0x3D` is zero. Otherwise they update the Card Interrupt field in the stored mask then write it to the low halfword of Signal Enable at `0x0D080038`, preserving the upper halfword.

| Bits | Field          | Firmware use                                               |
| ---- | -------------- | ---------------------------------------------------------- |
| `8`  | Card Interrupt | Clear to mask and set to unmask the card interrupt signal. |

## PHY and radio identification

`attach_phy` (`0x13EFD5BC`) reads the physical-layer hardware's version and radio identity before returning a PHY object. The following offsets are relative to the wireless core's base on the chip's internal backplane. WL accesses these registers through SDIO function 1.

| Offset  | Width   | Firmware access | Purpose                          |
| ------- | ------- | --------------- | -------------------------------- |
| `0x3E0` | 16 bits | Read            | PHY version                      |
| `0x3F6` | 16 bits | Write           | Radio register selector          |
| `0x3F8` | 16 bits | Read            | Upper half of the radio identity |
| `0x3FA` | 16 bits | Read            | Selected radio register data     |
| `0x3FC` | 16 bits | Write           | PHY register selector            |
| `0x3FE` | 16 bits | Read/write      | Selected PHY register data       |

The PHY version contains:

| Bits    | Field           | Firmware use                                   |
| ------- | --------------- | ---------------------------------------------- |
| `15:12` | Analog revision | Save in the PHY object.                        |
| `11:8`  | PHY type        | Accept `0`, `1`, `2` or `4` during attachment. |
| `3:0`   | PHY revision    | Save for later compatibility checks.           |

For the 2.4 GHz attachment path, a rejected PHY type makes `attach_phy` release its allocation and return a null pointer. After PHY attachment, `attach_wireless_core` (`0x13EDC774`) accepts PHY revisions `1`, `2`, `6`, `7` and `8`.

When the chip package is neither `14` nor `15`, attachment obtains the radio identity by writing selector `1` to `0x3F6` and reading `0x3F8`. It writes selector `1` again before reading `0x3FA`. The first read supplies the upper halfword and the second supplies the lower halfword:

```c
uint32_t identity = ((uint32_t)upper << 16) | lower;
```

| Bits    | Field          | Firmware use                  |
| ------- | -------------- | ----------------------------- |
| `31:28` | Radio revision | Save in the PHY object.       |
| `27:12` | Radio number   | Require `0x2050` or `0x2055`. |

A rejected radio number makes attachment release its allocation and return a null pointer. Packages `14` and `15` instead select the internal identifier `0xE4F5` without this identity read.

### Indirect PHY access

`read_phy` (`0x13EF54E0`) writes a 16 bit register index to `0x3FC` then reads 16 bits from `0x3FE`. `write_phy` (`0x13EF552C`) writes the index followed by the value. Selecting an index and writing its data are separate operations.

`set_phy_bits` (`0x13EF55DC`) selects a register, reads its value and writes the bitwise OR of that value and its mask. `mask_phy_bits` (`0x13EF557C`) performs the corresponding bitwise AND. Both operate on 16 bit values.

## Wireless core reset

`reset_core` (`0x13F24ADC`) resets the selected core through its Target State Low register at backplane offset `0xF98`:

| Bits | Field        | Firmware use                                          |
| ---- | ------------ | ----------------------------------------------------- |
| `0`  | Reset        | Set during reset and cleared before the core is used. |
| `16` | Clock enable | Kept set when releasing reset.                        |
| `17` | Force clocks | Set during reset and cleared after reset is released. |

After disabling the core, the routine writes the caller's core flags ORed with `0x00030001`. It then clears any detected error conditions, writes the flags ORed with `0x00030000` and finally ORed with `0x00010000`. After each of these three writes it reads Target State Low back and waits one microsecond.

During attachment, `test_wireless_registers` (`0x13ED2D58`) checks object data readback and the 16 bit views of the CFP start register. It then requires MAC control to read `0x00000400` or `0x80000400`. Any other value fails the register test and with it the wireless core attachment.

## MAC initialization

WL accesses the wireless chip's MAC registers through SDIO function 1. These addresses belong to the chip's backplane.

| Address      | Width   | Name             | Firmware use                               |
| ------------ | ------- | ---------------- | ------------------------------------------ |
| `0x18001120` | 32 bits | MAC control      | Stop and start microcode execution.        |
| `0x18001128` | 32 bits | Interrupt status | Poll the microcode startup response.       |
| `0x18001160` | 32 bits | Object address   | Select the destination for uploaded words. |
| `0x18001164` | 32 bits | Object data      | Write microcode and PCM data.              |

`init_mac` (`0x13EDF148`) writes `0x00000404` to MAC control before loading the [microcode](<microcode-hle.md>). `load_microcode` (`0x13ED4CE0`) writes object address `0x03000000` then streams the microcode through object data. `load_pcm` (`0x13ED4D48`) writes object address `0x000301EA` and data `0x00004000` then selects `0x000301EB` and streams the PCM data.

Every call to `init_mac` uploads both blocks. It does not check whether a previous call uploaded them. Each upload sends one 32 bit word per backplane write through `write_card`, producing a separate CMD53 transfer for each word. `load_microcode` uses the supplied byte count divided by four as its word count and returns the result of the final write. `init_mac` ignores the return values from both upload routines.

After uploading both blocks, initialization writes `0xFFFFFFFF` to interrupt status and `0x00020402` to MAC control. It polls the following status field:

| Bits | Field         | Firmware use                   |
| ---- | ------------- | ------------------------------ |
| `0`  | MAC suspended | End the startup wait when set. |

The polling loop starts with a budget of `1000009`. After each unsuccessful read, it subtracts `10` from the budget. If the previous budget exceeds `9`, it delays for 10 microseconds before reading again. Otherwise it exits the loop. Initialization continues after either a set status bit or budget exhaustion.

### HLE microcode upload shortcut

WL spams microcode upload which really messes with performance so it's possible to HLE the microcode load mechanism (`0x13ED4D1C`) to counteract that!

```c
int __fastcall load_microcode(int wireless, const unsigned int *data, unsigned int size)
{
  unsigned int word_count; // r5
  unsigned int index; // r4
  int result; // r0
  unsigned int word; // r3

  word_count = size >> 2;
  index = 0;
  for ( result = write_backplane(sdio: 0, address: *(_DWORD *)(wireless + 1956) + 352, size: 4u, value: 0x3000000u);
        index < word_count;
        result = write_backplane(sdio: 0, address: *(_DWORD *)(wireless + 1956) + 356, size: 4u, value: word) )
  {
    word = data[index++];
  }
  return result;
}
```

Basically you just do `cpu.registers[4] = cpu.registers[5] - 1;` lol.


### MAC suspension

`suspend_mac` (`0x13ED0EDC`) clears MAC control's enable field then polls the same MAC suspended status field. It delays for 10 microseconds between unsuccessful reads and stops after 3500 delays even if the status remains clear. It then reads MAC control and returns its value.

| Register                   | Bits | Field       | Firmware use                         |
| -------------------------- | ---- | ----------- | ------------------------------------ |
| MAC control (`0x18001120`) | `0`  | MAC enabled | Clear before waiting for suspension. |

## MAC interrupts

The wireless chip signals MAC events through the SDIO card interrupt. The host controller reports it in Card Interrupt (bit `8`) of Normal Interrupt Status at `0x0D080030`. It forwards it to Hollywood ARM interrupt 8 only while Card Interrupt is also set in Normal Interrupt Status Enable (`0x0D080034`) and Signal Enable (`0x0D080038`).

`interrupt_worker` (`0x13F0A1B0`) handles messages of type `2` by calling `handle_host_interrupt` (`0x13F1EC14`), which passes the host object to `dispatch_card_interrupt` (`0x13F1E390`). That routine returns early if Card Interrupt is clear in Normal Interrupt Status. Otherwise it saves Normal Interrupt Status Enable and clears its Card Interrupt bit. If the bytes at host object offsets `0x14` and `0x3D` are both nonzero, it calls the card handler registered in the host object. It then restores the saved value, so Card Interrupt is disabled only while the handler runs.

| Bits | Field          | Firmware use                                                         |
| ---- | -------------- | -------------------------------------------------------------------- |
| `8`  | Card Interrupt | Checked in `0x0D080030` and cleared in `0x0D080034` during handling. |

The card handler `card_interrupt` (`0x13F0A2A4`) calls `read_mac_interrupts` (`0x13ED7194`), which does the following:

1. It reads interrupt status at `0x18001128` and ANDs it with the driver's interrupt mask. If the read fails or the result is zero, it stops.
2. It writes the masked value back to `0x18001128`.
3. If bit `15` is set in that value, it writes `0x00010000` to `0x18001020`.
4. It saves the masked value for `process_mac_interrupts` (`0x13EF468C`).

| Bits | Field   | Firmware use                                               |
| ---- | ------- | ---------------------------------------------------------- |
| `15` | Receive | Read frames through the [receive FIFO](#pio-receive-fifo). |

## Channel selection

The 16 bit register at `0x180013F0` holds the current channel, encoded as its center frequency minus 2400 MHz. Channel 1 is `0x000C`, channel 6 is `0x0025` and channel 13 is `0x0048`.

During an access point search, WL tunes to each channel as follows:

1. Write `0x04020402` to MAC control, clearing MAC enabled.
2. Write the channel value to `0x180013F0`.
3. Write `0x04020403` to MAC control, setting MAC enabled.

## PIO receive FIFO

WL receives frames through a programmed I/O receive FIFO in the wireless core.

| Address      | Width   | Name                 | Firmware use                        |
| ------------ | ------- | -------------------- | ----------------------------------- |
| `0x18001308` | 32 bits | Receive FIFO control | Detect, accept and discard frames.  |
| `0x1800130C` | 32 bits | Receive FIFO data    | Read the receive record of a frame. |

| Bits | Field       | Firmware use                                                                 |
| ---- | ----------- | ---------------------------------------------------------------------------- |
| `0`  | Frame ready | Read as `1` when a frame is waiting. Written as `1` to accept it.            |
| `1`  | Data ready  | Polled until set after accepting a frame. Written as `1` to discard a frame. |

`pio_receive` (`0x13F0D284`) reads one frame as follows:

1. It reads receive FIFO control and returns without a frame if Frame ready is clear.
2. It writes `1` to receive FIFO control.
3. It polls receive FIFO control for Data ready, reading up to 11 times with a 10 microsecond delay between reads. If Data ready never sets, it returns without a frame and without discarding it.
4. It reads the first data word, takes the frame size from it and allocates a packet buffer with a packet length of the frame size plus 30.
5. It stores the first word at buffer offset `0x00` and reads four more words into offsets `0x04` to `0x13`.
6. If bit `0` of the MAC status at offset `0x0C` is set, it discards the frame.
7. It reads the frame data into the buffer at offset `0x1E`. If that address is not word aligned and the frame is longer than one byte, it first reads 2 bytes into `0x1E` and continues at `0x20`.
8. It reads the remaining whole words, then one more word for any leftover bytes.

To discard a frame, the routine writes `2` to receive FIFO control and releases the packet buffer. It also discards the frame if allocation or a bulk read fails.

Depending on some random bullshit, the header and frame data are read either one 32 bit word at a time or with `read_backplane_bulk` (`0x13F1C9B8`). Every read targets `0x1800130C`. Each path stores the record bytes in the order the card sends them:

- A single read passes through the [byte reversal](#backplane-access-helpers) in `transfer_card` and is stored as a native big endian word.
- `read_backplane_bulk` calls `transfer_extended` (`0x13F1E434`) for a CMD53 read of function 1 at a fixed address. It uses byte mode for transfers shorter than function 1's block size or for all transfers when the host object disables block mode. The routine waits for Buffer Read Ready, acknowledges it, reads the words from Buffer Data at `0x0D080020` and reverses the bytes of each word itself.
- A bulk transfer of at least one block uses block mode, with SDMA when the host object enables DMA. For SDMA, `send_command` writes the bounce buffer's address to `0x0D080000` and sets transfer mode bit `0`. After Transfer Complete, `transfer_extended` acknowledges Transfer Complete and DMA Interrupt by writing `0x000A` to `0x0D080030` and copies the bounce buffer to the destination without byte reversal.

The transfer mode bits occupy the low halfword of the command word at `0x0D08000C`:

| Bits | Field                   | Firmware use                                            |
| ---- | ----------------------- | ------------------------------------------------------- |
| `0`  | DMA Enable              | Set for block mode CMD53 transfers when DMA is enabled. |
| `1`  | Block Count Enable      | Set when the block count exceeds one.                   |
| `4`  | Data Transfer Direction | Set for reads.                                          |
| `5`  | Multiple Block          | Set when the block count exceeds one.                   |

A single block SDMA read therefore uses transfer mode `0x0011`. In block mode, `0x0D080004` holds the block size in its low halfword and the block count from the CMD53 argument in its upper halfword.

### Receive record

The receive record is a 20 byte header followed by the frame data. Header fields are 16 bit little endian values.

| Offset | Size    | Firmware use                                                    |
| ------ | ------- | --------------------------------------------------------------- |
| `0x00` | 2 bytes | Frame size, the number of frame data bytes after the header.    |
| `0x04` | 2 bytes | PHY status 0, used for the [signal strength](#signal-strength). |
| `0x06` | 2 bytes | PHY status 1, used for the signal strength.                     |
| `0x0A` | 2 bytes | PHY status 3, used for the signal strength.                     |
| `0x0C` | 2 bytes | [MAC status](<microcode-hle.md#receive-header>).                |

| MAC status bits | Firmware use                              |
| --------------- | ----------------------------------------- |
| `0`             | Discard the frame.                        |
| `2`             | Two padding bytes precede the frame data. |

The frame data starts with a 6 byte physical layer header, followed by the 802.11 frame and its frame check sequence. Before parsing, WL converts the header halfwords from little endian to native order. It then skips the 30 bytes that precede the frame data, plus 2 more if the padding bit is set.

### Scan results

WL finds and joins networks through 802.11 management frames such as beacons and probe responses. It passes them to `receive_management` (`0x13EF30F4`). A probe response is added to the scan results by `add_scan_result` (`0x13ED9170`) when both of these conditions hold:

- The word at driver object offset `0x143C` is not `-1`.
- The frame's first address equals the station address at driver object offset `0x24`.

A beacon is added only when bit `2` of the byte at driver object offset `0x1442` is also set. `parse_bss_info` (`0x13ED8A18`) reads the advertised network's capability information, SSID, supported rates and DS parameter set.

### Joining an open network

For an open-system connection, WL authenticates before sending an association request. `set_association_state` (`0x13ED1160`) stores the current state at driver object offset `0xF7C`. The successful station path uses these states and events:

| State | Expected response                                                | Successful event    | Next state |
| ----- | ---------------------------------------------------------------- | ------------------- | ---------- |
| `2`   | Open-system authentication response with transaction sequence 2. | `3`                 | `5`        |
| `5`   | Association response.                                            | `7`                 | `6`        |
| `6`   | Beacon from the selected BSSID.                                  | `1` followed by `0` | `0`        |

`receive_management` checks the selected BSSID before accepting these responses. A successful association response stores its association ID at driver object offset `0x1A56`. `process_wireless_event` (`0x13EE02D4`) handles the success event through `activate_association` (`0x13EE1418`), which enters state `6` for the station connection.

Association alone does not complete the join. In state `6`, a beacon from the selected BSSID reaches `complete_join_from_beacon` (`0x13EE39EC`). It emits event `1` with status zero. For an initial join, the event handler emits event `0` with status zero and returns the association state to `0`.

### Signal strength

`compute_rssi` (`0x13F02660`) derives a signed signal strength from the converted receive header. For radio `0x2050`, when bit `0` of PHY status 0 is set:

```c
int rssi = (int8_t)(phy_status_1 & 0xFF);
if (phy_status_3 & 0x0400)
    rssi += 17;
else
    rssi -= 4;
```

| Field        | Bits  | Firmware use                               |
| ------------ | ----- | ------------------------------------------ |
| PHY status 0 | `0`   | Select the direct signed sample when set.  |
| PHY status 1 | `7:0` | Signed sample before the radio correction. |
| PHY status 3 | `10`  | Add 17 when set. Subtract 4 when clear.    |

### HLE frame reception

A microcode HLE can deliver management and data frames through this receive path. The other interfaces it has to provide are covered under [Microcode HLE](<microcode-hle.md#hle>).

To deliver a frame:

1. Queue a receive record made of a 20 byte header, a 6 byte physical layer header, the 802.11 frame and a 4 byte frame check sequence. WL accepts a physical layer header and frame check sequence filled with zeros. The frame size covers everything after the 20 byte header.
2. Set Frame ready in receive FIFO control and set bit `15` of interrupt status at `0x18001128`.
3. If the MAC interrupt mask enables bit `15`, raise the SDIO card interrupt, subject to the host controller enables described under [MAC interrupts](#mac-interrupts).
4. After WL writes `1` to receive FIFO control, report Data ready.
5. Serve every read of `0x1800130C` from the next bytes of the record, whether it is a single word, a 16 byte read in byte mode or an SDMA read in block mode. Drop the record once its last byte has been read or when WL writes `2`.

To make an access point appear in the search, send a probe response addressed to the station address while WL is tuned to the access point's channel and MAC enabled is set again. To report a signal strength on radio `0x2050`, set PHY status 0 bit `0`, clear PHY status 3 bit `10` and store the desired value plus 4 as a signed 8 bit value in PHY status 1 bits `7:0`.

## Frame transmission

WL uses six PIO FIFOs. For FIFO index `n` from 0 through 5, the transmit registers have these wireless backplane addresses:

| Address                 | Width   | Access | Purpose           |
| ----------------------- | ------- | ------ | ----------------- |
| `0x18001300 + 0x10 * n` | 32 bits | R/W    | Transmit control. |
| `0x18001304 + 0x10 * n` | 32 bits | W      | Transmit data.    |

`pio_transmit` (`0x13F0CD8C`) submits a packet chain through the selected FIFO. It writes `0x00000080` to transmit control before copying data and writes `0x00000010` after the final fragment. Between these writes it selects the valid bytes of each data word through the low four control bits:

| Bits  | Firmware use                                             |
| ----- | -------------------------------------------------------- |
| `3:0` | Byte enables. Bit `n` selects byte `n` of the data word. |
| `4`   | Submit the accumulated frame.                            |
| `7`   | Start writing a frame.                                   |

For an unaligned fragment, WL enables only the occupied lanes of its first aligned word. It then enables all four lanes while transferring complete words and enables only the occupied lanes of the final word. Fragment boundaries do not submit the frame. `transfer_card` (`0x13F1D7AC`) reverses the byte order of individual PIO data writes so the FIFO receives packet bytes in memory order. Bulk transfers through `transfer_fifo` (`0x13F1CA18`) use fixed-address CMD53 writes to the same data register.

`build_transmit_header` (`0x13ED5D04`) prepends a 100 byte transmit header and a 6 byte physical layer header to the 802.11 frame. Offsets are relative to the start of the transmit record. The frame ID and status are little endian:

| Byte offset | Size     | Field                                 |
| ----------- | -------- | ------------------------------------- |
| `0x48`      | 2 bytes  | Frame ID.                             |
| `0x4A`      | 2 bytes  | Initial transmit status, set to zero. |
| `0x64`      | 6 bytes  | Physical layer header.                |
| `0x6A`      | Variable | 802.11 frame.                         |

The frame ID's low three bits select the FIFO. After submission, WL retains the packet in that FIFO's software queue until [transmit completion](<microcode-hle.md#transmit-completion>). `process_transmit_status` (`0x13EE17AC`) selects the queue from the returned frame ID and releases a completed packet. `release_pio_transmit` (`0x13F0CA7C`) decrements the queued frame count and subtracts the packet chain length rounded up to a multiple of four from the queued byte count.

| Frame ID bits | Meaning              |
| ------------- | -------------------- |
| `2:0`         | Transmit FIFO index. |

### FIFO capacity

During `init_mac`, `write_initial_registers` (`0x13ED2268`) programs shared memory through the object registers. One sequence writes object address `0x03010025` then writes `0x00320000`, `0x090A0E09` and `0x0000060E` to object data. The streamed words occupy consecutive shared memory word pairs starting at byte offset `0x94`.

`read_shm_bytes` (`0x13ED4DF4`) reads six bytes starting at shared memory byte offset `0x98`. `init_mac` multiplies each byte by 256 to initialize a FIFO's capacity when its software capacity is zero:

| FIFO | Shared memory byte offset | Capacity byte | Capacity   |
| ---- | ------------------------- | ------------- | ---------- |
| 0    | `0x98`                    | `0x09`        | 2304 bytes |
| 1    | `0x99`                    | `0x0E`        | 3584 bytes |
| 2    | `0x9A`                    | `0x0A`        | 2560 bytes |
| 3    | `0x9B`                    | `0x09`        | 2304 bytes |
| 4    | `0x9C`                    | `0x0E`        | 3584 bytes |
| 5    | `0x9D`                    | `0x06`        | 1536 bytes |

`pio_has_space` (`0x13F0C9CC`) rejects a submission that would exceed 32 queued frames or the FIFO's byte capacity. For one frame it rounds the packet chain length up to a multiple of four bytes. It also rejects submission while transmit control bit `8` is set.

| Transmit control bits | Firmware use                                                  |
| --------------------- | ------------------------------------------------------------- |
| `8`                   | Suspend transmission. A set bit prevents further submissions. |

## Delays

`delay` uses a timer and a message queue for requests above 1,000 microseconds. It creates a queue with one message slot, starts a one-shot timer and blocks waiting for its message. It destroys the timer and queue before returning.

For requests of at most 1,000 microseconds, it polls [timer syscall `0x15`](<../index.md#syscalls>). It converts the requested duration to ticks as follows:

```c
uint32_t ticks = microseconds * 19 / 10;
if (ticks <= 20)
    ticks -= ticks / 4;
```

It reads a starting counter value. If `ticks` is zero, it returns without polling. Otherwise each poll computes `current - start` with 32 bit unsigned wraparound. If the signed 32 bit value of `current` is less than or equal to the signed value of `start`, it subtracts one more tick from that difference. Polling ends when the adjusted unsigned difference is at least `ticks`. Equal counter samples therefore produce `0xFFFFFFFF` and end the wait.

| Firmware    | `delay`      |
| ----------- | ------------ |
| IOS80 v6944 | `0x13F0AA28` |
| IOS70 v6687 | `0x13F0A9F4` |
