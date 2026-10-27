# SDI

SDI provides `/dev/sdio/slot0` for the front SD slot at physical address `0x0D070000`.

## Interrupt dispatch

`dispatch_slot_interrupt` (`0x20400ED8`) reads the low 16 bits of the word at `0x0D0700FC` to find the slot that needs service:

| Bits | Field                    | Firmware use                                                         |
| ---- | ------------------------ | -------------------------------------------------------------------- |
| 0    | Slot 0 interrupt pending | Services the current slot.                                           |
| 1    | Slot 1 interrupt pending | If bit 0 is clear, increments the slot index and services that slot. |

If neither bit is set, the dispatcher stores `-1` in the slot index and returns `-1` without reading or acknowledging the normal interrupt status. An interrupt notification reaching IOS is not enough on its own. The slot status bit has to be set as well.

`handle_slot_interrupt` (`0x20400AA0`) saves the normal interrupt signal enable value and writes zero to the field. It reads the normal interrupt status and writes the sampled value back to acknowledge the pending events before it processes them. Before returning it restores the saved signal enable value.

| Physical address | Field                          | SDI access                                  |
| ---------------- | ------------------------------ | ------------------------------------------- |
| `0x0D070030`     | Normal Interrupt Status        | Reads and acknowledges the low 16 bits.     |
| `0x0D070038`     | Normal Interrupt Signal Enable | Saves, clears and restores the low 16 bits. |
| `0x0D0700FC`     | Slot Interrupt Status          | Reads the low 16 bits to select the slot.   |

`read_register16` (`0x20400CC0`) reads the aligned 32 bit word and extracts the selected half. `write_register16` (`0x20400CDC`) reads the containing word, replaces the selected half and writes the whole word back.

### Command and transfer completion

| Normal interrupt bit | Meaning           | Firmware action                                                                                                                                                            |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0                    | Command complete  | Copies the four response words at offsets `0x10` through `0x1C` into the pending request's response buffer. Completes the request unless a data transfer is still pending. |
| 1                    | Transfer complete | Clears the pending data state and marks the request complete.                                                                                                              |
| 3                    | DMA boundary      | Reads the DMA address at offset `0x00` and writes it back.                                                                                                                 |

Offsets are relative to the selected slot's register base. Command completion and transfer completion are separate events, so a request with a pending data transfer is not complete until transfer complete arrives.

## Block reads

`start_command` (`0x20400534`) turns a `CMD18` read with a block count of one into `CMD17` before submitting it. Reads of more than one block keep `CMD18`.

For a data transfer it writes the DMA buffer address at offset `0x00`, the block size at `0x04` and the block count at `0x06`. It then writes the command argument at `0x08` and submits the combined transfer mode and command word at `0x0C`. These offsets are relative to the selected slot's register base.

## Block writes

`start_command` turns a `CMD25` write with a block count of one into `CMD24`. Writes of more than one block keep `CMD25`. Writes use the same DMA, block-size and block-count registers as [reads](#block-reads).

### Write protection

The routine reads Present State before submitting a data transfer:

| Physical address | Width   | Access | Name          |
| ---------------- | ------- | ------ | ------------- |
| `0x0D070024`     | 32 bits | R      | Present State |

| Bit | Field             | Firmware use                                       |
| --- | ----------------- | -------------------------------------------------- |
| 19  | Write protect pin | A clear bit rejects writes. A set bit allows them. |

If bit 19 is clear, a write data transfer returns `-10` before programming the DMA address or submitting the command. Reads are permitted regardless of this bit.
