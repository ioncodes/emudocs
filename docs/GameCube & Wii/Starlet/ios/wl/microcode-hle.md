# Microcode HLE

During [MAC initialization](<index.md#mac-initialization>), WL uploads a microcode image to the wireless core. The microcode runs on the core's programmable state machine and handles medium access and transmission, acknowledgements, receive filtering and building the receive header that precedes every frame in the receive FIFO. WL never calls into the microcode directly. It talks to it through shared memory, MAC control, the MAC command register, interrupt status and the FIFOs. A high-level emulation (HLE) of the microcode has to provide these interfaces.

## Image

`g_microcode` (`0x13F29DF0`) holds `0x5D00` bytes, which is 2976 instructions of 8 bytes each. WL uploads it to offset `0` of microcode memory. On this page, microcode addresses are byte offsets into microcode memory and WL addresses are Starlet virtual addresses in IOS80. Execution starts at `reset` (`0x0000`), which clears the GPIO output and jumps to [`init`](#startup-and-suspension) (`0x4078`).

During startup, the microcode publishes its version in shared memory:

| Word    | Name       | Value    |
| ------- | ---------- | -------- |
| `0x000` | UCODEREV   | `0x014B` |
| `0x001` | UCODEPATCH | `0x0196` |
| `0x002` | UCODEDATE  | `0x7915` |
| `0x003` | UCODETIME  | `0x915D` |

## Shared memory

Shared memory is an array of 16 bit words. The microcode addresses it by word index, while the host uses byte offsets, so word `n` sits at byte offset `2n`. The host selects a word through the object address register and then accesses one halfword of the object data register. `write_shm` (`0x13ED01C4`) and `read_shm` (`0x13ED03F4`) take an even byte offset and work like this, with the driver argument omitted:

```c
void write_shm(uint32_t offset, uint16_t value)
{
    write32(0x18001160, 0x00010000 | (offset >> 2));
    write16((offset & 2) ? 0x18001166 : 0x18001164, value);
}

uint16_t read_shm(uint32_t offset)
{
    write32(0x18001160, 0x00010000 | (offset >> 2));
    return read16((offset & 2) ? 0x18001166 : 0x18001164);
}
```

These words make up the host interface:

| Word            | Byte offset   | Name               | Microcode use                                      | WL use                                                   |
| --------------- | ------------- | ------------------ | -------------------------------------------------- | -------------------------------------------------------- |
| `0x000`-`0x003` | `0x00`-`0x06` | Version words      | Written by `init`.                                 | `init_mac` (`0x13EDF148`) reads UCODEREV and UCODEPATCH. |
| `0x01A`         | `0x34`        | Receive pad offset | Added to the receive length of padded frames.      |                                                          |
| `0x020`         | `0x40`        | UCODESTAT          | Current [microcode state](#ucodestat).             | Polled after waking the MAC.                             |
| `0x028`         | `0x50`        | PHYVER             | Bits `7:0` of the PHY version, written by `init`.  |                                                          |
| `0x029`         | `0x52`        | PHYTYPE            | Bits `11:8` of the PHY version, written by `init`. |                                                          |
| `0x044`-`0x046` | `0x88`-`0x8C` | JSSI 0, 1 and AUX  | Results of the [noise measurement](#mac-commands). |                                                          |

`init_mac` (`0x13EDF148`) reads the version words after its startup wait and combines them into one word, with UCODEREV in the high halfword and UCODEPATCH in the low halfword. The wait also ends on timeout, so these reads can happen before startup has actually finished.

### UCODESTAT

| Value | State     | Written by                                                                               |
| ----- | --------- | ---------------------------------------------------------------------------------------- |
| `1`   | Init      | `init`, after clearing shared memory.                                                    |
| `3`   | Suspended | `suspend` (`0x3778`), after raising interrupt status bit `0`.                            |
| `2`   | Active    | `suspend` once MAC enabled is set. Also the power save routine (`0x42E0`) when it wakes. |
| `4`   | Sleep     | The power save routine, before its sleep loop.                                           |

`update_power_save` (`0x13ED045C`) updates MAC control bits `25` and `26`. If it sets bit `26` while bit `25` was already set and bit `26` was clear, it waits 40 microseconds and then polls UCODESTAT until it reads a value other than `4`. It reads at most 27 times with a 10 microsecond delay between reads and gives up after the last read without delaying again. Both waits go through the [WL delay helper](<index.md#delays>).

## MAC control

WL accesses MAC control at backplane address `0x18001120`. The microcode reads its upper half through register `0x041`.

| MAC control bits | Microcode use                                                       |
| ---------------- | ------------------------------------------------------------------- |
| `0`              | MAC enabled. The suspended loop waits for this bit to be set.       |
| `23`             | Keep frames with a bad frame check sequence.                        |
| `25`             | Enable the power save path.                                         |
| `26`             | Request that the MAC stay awake. WL polls UCODESTAT when waking it. |
| `29`             | Skip writing transmit status entries in `finish_tx` (`0x1F58`).     |
| `31`             | Select the G-mode register bank used by noise measurement.          |

### Host flags

| Shared memory word | Bits | Use                                             |
| ------------------ | ---- | ----------------------------------------------- |
| `0x02F`            | `15` | Defer the current transmit status entry.        |
| `0x030`            | `9`  | Enable the radio switch check in the main loop. |

## Interrupts raised by the microcode

The microcode raises interrupt status bits at `0x18001128` by writing microcode register `0x042` for bits `15:0` and `0x043` for bits `31:16`. The routines on this page raise these bits:

| Bit | Raised by                       | Condition                                       |
| --- | ------------------------------- | ----------------------------------------------- |
| `0` | `suspend` (`0x3778`)            | Every entry into the suspended state.           |
| `7` | `finish_tx` (`0x1F58`)          | Reaching the status reporting path at `0x1FB0`. |
| `8` | `transfer_rx_header` (`0x41E0`) | A header transfer completed without overflow.   |

The [measurement commands](#mac-commands) raise their own completion interrupts only once a requested measurement finishes.

The microcode never raises bit `15` or bit `29` itself, even though WL relies on both. Bit `15` tells WL to [drain the receive FIFO](<index.md#mac-interrupts>) and bit `29` tells it to read transmit status. They are separate from bits `8` and `7`, which the microcode raises on receive and transmit respectively.

## Startup and suspension

`init` runs after reset. The pseudocode below covers its shared memory setup and leaves out internal engine setup. Here and in later examples, helpers and header fields without a firmware address are pseudocode names. `read_external()` is the microcode's indirect read of a core register, where index `0` is the PHY version.

```c
// 0x4078
void init(void)
{
    for (int word = 0x7FF; word >= 0; word--)
        shm[word] = 0;

    shm[UCODESTAT] = 1;

    uint16_t phy_version = read_external(0);
    shm[PHYVER] = phy_version & 0xFF;
    shm[PHYTYPE] = (phy_version >> 8) & 0xF;

    shm[0x0C0] = 0x0039;
    shm[0x0C2] = 0x0050;
    shm[0x0C4] = 0xFC00;
    shm[0x011] = 0xFF00;
    if (shm[PHYTYPE] == 2 && (microcode_register[0x01C] & 0x0100) && shm[PHYVER] == 0)
        shm[0x011] = 0;

    shm[UCODEREV] = 0x014B;
    shm[UCODEPATCH] = 0x0196;
    shm[UCODEDATE] = 0x7915;
    shm[UCODETIME] = 0x915D;

    goto suspend;
}
```

| Source                     | Bits   | Initialization use                                                            |
| -------------------------- | ------ | ----------------------------------------------------------------------------- |
| PHY version                | `7:0`  | Stored in PHYVER.                                                             |
| PHY version                | `11:8` | Stored in PHYTYPE.                                                            |
| Microcode register `0x01C` | `8`    | With PHYTYPE `2` and PHYVER `0`, selects zero for shared memory word `0x011`. |

Clearing shared memory wipes anything the host wrote to words `0x000` through `0x7FF` before startup. WL writes its shared memory configuration after the startup wait in `init_mac`.

`suspend` (`0x3778`) reports the suspended state and waits for the host. `resume` (`0x37B8`) follows directly:

```c
// 0x3778
suspend:
    raise_interrupt(0);
    shm[UCODESTAT] = 3;
    while (!mac_enabled())
        ;
    shm[UCODESTAT] = 2;

// 0x37B8
resume:
    reset_rx();
    goto main_events;
```

`mac_enabled()` tests [MAC control bit `0`](#mac-control). The first pass through `suspend` raises interrupt status bit `0`, which `init_mac` polls for after starting the microcode.

`reset_rx` (`0x37F0`) clears the microcode's internal branch state and condition latches, resets receive processing and empties the queue of pending probe responses.

When the main loop sees MAC enabled clear, it branches to `mac_disabled` (`0x3760`), which leads into `suspend`. [`suspend_mac`](<index.md#mac-suspension>) (`0x13ED0EDC`) waits for the resulting interrupt before it proceeds. Setting MAC enabled again writes UCODESTAT `2` and resumes execution.

## Main loop

`main_loop` (`0x0010`) checks hardware and software work flags before sleeping. `main_events` (`0x0048`) checks for the following work in order. A taken branch can skip the remaining checks.

1. The radio hardware switch, when the [host flag](#host-flags) enables its check.
2. Deferred transmit status and acknowledgements.
3. MAC enabled. When it is clear, the loop enters `mac_disabled`.
4. A transmit FIFO flush request.
5. Transmit events at `tx_events` (`0x0140`).
6. Receive events at `rx_events` (`0x0180`), including `begin_rx` (`0x27A0`) and `finish_rx` (`0x2D88`).
7. The [MAC commands](#mac-commands) for noise measurement and clear channel assessment.
8. Beacon interval events and the start of the next transmission.

## Receive

`begin_rx` (`0x27A0`) runs at the start of a frame. It latches the 64 bit timing synchronization function (TSF) timer, builds the receive header's channel word and waits until `0x26` bytes have arrived or the frame is complete. It then clears both MAC status words. If at least `0x10` bytes arrived, it reads the frame control field and classifies the frame.

`finish_rx` (`0x2D88`) runs at the end of the frame. It records the receive timestamp, checks the frame check sequence, applies address filtering and fills in the remaining header fields. A frame that fails address filtering is dropped before it reaches the FIFO. A frame with a bad frame check sequence is only kept when [MAC control bit `23`](#mac-control) is set. It is then marked with MAC status bit `0`, which makes [`pio_receive`](<index.md#pio-receive-fifo>) (`0x13F0D284`) discard it.

The normal header path starts at `0x3090`. This excerpt shows the length and PHY status writes. Internal receive state can still divert execution before the header transfer.

```c
// finish_rx, normal header construction
shm[RXHDR_LENGTH] = rx_byte_count;
if (padding_inserted) {
    shm[RXHDR_LENGTH] += shm[0x01A];
    shm[RXHDR_MAC_STATUS_LOW] |= 0x0004;
}
shm[RXHDR_PHY_STATUS_0] = phy_status[0];
shm[RXHDR_PHY_STATUS_1] = phy_status[1];
shm[RXHDR_PHY_STATUS_2] = phy_status[2];
shm[RXHDR_PHY_STATUS_3] = phy_status[3];
transfer_rx_header();
```

`transfer_rx_header` (`0x41E0`) hands the prepared receive header to the receive engine without the frame body. It returns immediately if bit `9` of internal register `r45` is set. Otherwise it points the engine at the 10 word header in shared memory, starts the transfer and waits for the busy condition to set and then clear. It checks for receive overflow throughout this wait and once more before raising interrupt status bit `8`.

```c
void transfer_rx_header(void)
{
    if (skip_rx_header)
        return;

    rx_header_source = 0x548;
    rx_header_words = 10;
    rx_header_control = 1;

    do {
        if (receive_overflow_pending())
            goto overflow;
    } while (!header_transfer_busy());
    do {
        if (receive_overflow_pending())
            goto overflow;
    } while (header_transfer_busy());
    if (receive_overflow_pending())
        goto overflow;
    raise_interrupt(8);
    return;

overflow:
    handle_receive_overflow();
}
```

The pseudocode names map to these internal fields:

| Register | Bits   | Pseudocode field    | Use                                                      |
| -------- | ------ | ------------------- | -------------------------------------------------------- |
| `r45`    | `9`    | `skip_rx_header`    | Return without transferring a header or raising bit `8`. |
| `0x007`  | `15:0` | `rx_header_source`  | Shared memory word index `0x548`.                        |
| `0x008`  | `15:0` | `rx_header_words`   | Header length of 10 words.                               |
| `0x004`  | `1:0`  | `rx_header_control` | Set to `1` to begin the header transfer.                 |

`header_transfer_busy()` tests microcode condition `0x0B` and `receive_overflow_pending()` tests condition `0x0D`. `handle_receive_overflow()` is a branch to `rx_overflow` (`0x3728`), which leaves the helper without raising the interrupt or returning normally.

### Receive header

The header occupies shared memory words `0x548` to `0x551` and forms the first 20 bytes of the [receive record](<index.md#receive-record>):

| Word    | Record offset | Field        | Source                                                                          |
| ------- | ------------- | ------------ | ------------------------------------------------------------------------------- |
| `0x548` | `0x00`        | Frame size   | Received byte count, plus the receive pad offset for padded frames.             |
| `0x54A` | `0x04`        | PHY status 0 | PHY receive status register 0 (microcode register `0x009`).                     |
| `0x54B` | `0x06`        | PHY status 1 | PHY receive status register 1 (microcode register `0x00A`).                     |
| `0x54C` | `0x08`        | PHY status 2 | PHY receive status register 2 (microcode register `0x01A`).                     |
| `0x54D` | `0x0A`        | PHY status 3 | PHY receive status register 3 (microcode register `0x01B`).                     |
| `0x54E` | `0x0C`        | MAC status   | See below.                                                                      |
| `0x550` | `0x10`        | Receive time | Low 16 bits of the TSF timer latched at reception (microcode register `0x11F`). |
| `0x551` | `0x12`        | Channel word | See below.                                                                      |

| MAC status bits | Meaning                                         |
| --------------- | ----------------------------------------------- |
| `0`             | The frame check sequence did not match.         |
| `1`             | The microcode started a response to this frame. |
| `2`             | Padding was inserted before the frame data.     |

| Channel word bits | Source                                  |
| ----------------- | --------------------------------------- |
| `1:0`             | Bits `1:0` of PHYTYPE.                  |
| `9:2`             | Bits `7:0` of external register `0x08`. |
| `14:10`           | Bits `4:0` of external register `0x25`. |

## Transmit completion

`finish_tx` (`0x1F58`) handles the frame at the head of the current transmit FIFO. On the status reporting path, it sets status bit `6` if the frame has to stay at the head and otherwise asks for it to be released. It then raises interrupt status bit `7`. [MAC control bit `29`](#mac-control) skips the status entry writes but not the interrupt.

`count_tx_attempt` (`0x4248`) increments one of the status word's two 4 bit attempt counters, selected by the transmit state. Each counter wraps within its 4 bits. Probe responses take a separate path that increments shared memory word `0x560` instead.

At `0x1FF8`, `finish_tx` copies bit `0` of the internal status into bit `1` of the status entry. Before handling the current entry, it calls `report_saved_tx_status` (`0x4B10`) to write out any previously saved one. If [host flag](#host-flags) `0x02F` bit `15` is set, the current entry is saved in shared memory for that helper to report later. Otherwise it is written immediately:

```c
uint16_t status = header.status;
status = (status & ~0x0002) | ((status & 0x0001) << 1);
report_saved_tx_status();
if (defer_tx_status) {
    save_tx_status(status & ~0x0001, header);
} else {
    tx_status[3] = header.word_28;
    tx_status[2] = header.word_27;
    tx_status[1] = header.word_24;
    tx_status[0] = status | 0x0001;
}
```

`save_tx_status()` stands for the shared memory writes and setting the pending flag. The `header.word_*` suffixes are word offsets into the microcode's copy of the current transmit header, where the status word sits at offset `0x25`. An entry goes to these registers when written immediately and to these shared memory words when saved:

| Microcode register | Value                     | Saved shared memory word |
| ------------------ | ------------------------- | ------------------------ |
| `0x08F`            | Header word `0x28`        | `0x564`                  |
| `0x08E`            | Header word `0x27`        | `0x563`                  |
| `0x08D`            | Header word `0x24`        | `0x562`                  |
| `0x08C`            | Status with valid bit set | `0x561` with bit `0` set |

`report_saved_tx_status` does nothing if `r45` bit `0` is clear. Otherwise it writes the saved words to the registers in the order above and clears the pending flag.

| Register | Bits | Meaning                                   |
| -------- | ---- | ----------------------------------------- |
| `r45`    | `0`  | A saved transmit status entry is pending. |

| Status bits | Meaning                                  |
| ----------- | ---------------------------------------- |
| `15:12`     | Attempt counter.                         |
| `11:8`      | Attempt counter.                         |
| `6`         | The frame stays at the head of its FIFO. |
| `1`         | Copy of bit `0` of the internal status.  |
| `0`         | Valid. Set when the entry is reported.   |

On interrupt status bit `29`, WL's `process_mac_interrupts` (`0x13EF468C`) reads transmit status entries. For each one, it reads `0x18001170` and stops if bit `0` is clear. Otherwise it reads the entry from `0x18001174` and processes it. With a nonzero work limit argument, it reads at most eight entries per call.

| Register     | Bits | WL use                                                     |
| ------------ | ---- | ---------------------------------------------------------- |
| `0x18001170` | `0`  | Continue reading a status entry when set. Stop when clear. |

The two reads provide these fields to WL's `process_transmit_status` (`0x13EE17AC`):

| Register     | Bits    | Field                                                               |
| ------------ | ------- | ------------------------------------------------------------------- |
| `0x18001170` | `31:16` | Frame ID from the [transmit header](<index.md#frame-transmission>). |
| `0x18001170` | `15:0`  | Transmit status.                                                    |
| `0x18001174` | `15:0`  | Sequence value.                                                     |

| Transmit status bits | WL use                                             |
| -------------------- | -------------------------------------------------- |
| `15:12`              | Frame transmit attempt count.                      |
| `6`                  | Intermediate report. WL retains the queued packet. |
| `1`                  | Acknowledged transmission.                         |
| `0`                  | Valid entry.                                       |

## MAC commands

The main loop reads host commands from the MAC command register (microcode register `0x047`). Each measurement routine below returns immediately unless its command bit is set. When the measurement completes, it writes the bit back to clear it and raises the matching interrupt.

| Command bit | Routine                    | Completion                                           |
| ----------- | -------------------------- | ---------------------------------------------------- |
| `3`         | `measure_cca` (`0x54F8`)   | Clears bit `3` and raises interrupt status bit `17`. |
| `4`         | `measure_noise` (`0x5328`) | Clears bit `4` and raises interrupt status bit `18`. |

`measure_noise` (`0x5328`) measures background noise. The pseudocode shows the path for PHY types other than `0`. All shared memory words and TSF timer halves are unsigned 16 bit values. `wait_for_noise_sample(us, ignore_ifs)` waits until the low half of the TSF timer reaches its starting value plus `us`, modulo `65536`. It returns false early if condition `0x20` is set or if interframe space status bit `11` is set while `ignore_ifs` is false.

```c
void measure_noise(void)
{
    if (!(mac_command & 0x0010))
        return;
    if (!noise_pending) {
        noise_pending = true;
        read_tsf_low();
        shm[0x569] = read_tsf_high();
    }
    read_tsf_low();
    uint16_t elapsed_high = read_tsf_high() - shm[0x569];

    shm[JSSI_AUX] = (read_external(0x08) & 0xFF)
        | ((read_external(gmode ? 0x45F : 0x05F) & 0xFF) << 8);

    int word = 0x044;
    for (int i = 0; i < 4; i++) {
        if (!wait_for_noise_sample(2, elapsed_high >= 2))
            return;
        shm[word] = (shm[word] & ~0x01FF) | (read_external(0x27) & 0x01FF);
        shm[word] = rotate_right_16(shm[word], 8);
        word ^= 1;
    }
    if (elapsed_high < 2 && !wait_for_noise_sample(24, false))
        return;

    mac_command = 0x0010;
    raise_interrupt(18);
    noise_pending = false;
}
```

The four samples alternate between JSSI 0 and JSSI 1. `gmode` is [MAC control bit `31`](#mac-control) as latched when the microcode left `suspend`. The final 24 microsecond wait is skipped when `elapsed_high`, computed once on entry, is at least 2. An interrupted pass leaves the command bit and pending flag set, so the next call takes a fresh set of samples while keeping the original timestamp.

| Register | Bits | Pseudocode field or use                                                          |
| -------- | ---- | -------------------------------------------------------------------------------- |
| `r20`    | `3`  | `noise_pending`, retaining the initial timestamp across interrupted passes.      |
| `0x148`  | `11` | Interframe space condition that aborts a wait unless ignored as described above. |

`measure_cca` (`0x54F8`) performs clear channel assessment. On completion it writes `0x4000` to microcode register `0x133`, updates registers `0x136` and `0x137`, clears command bit `3` and raises interrupt status bit `17`. It does not modify the JSSI words.

## HLE

An HLE has to provide the following behavior to WL and keep the microcode's own interrupts separate from the FIFO notifications:

| Routine              | Address            | Behavior exposed to WL                                                                                               |
| -------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `init`               | `0x4078`           | Clear shared memory, publish the version words and PHY identity, then enter `suspend`.                               |
| `suspend`, `resume`  | `0x3778`, `0x37B8` | Raise interrupt bit `0` and write UCODESTAT `3` when suspending. Write UCODESTAT `2` on resume.                      |
| `transfer_rx_header` | `0x41E0`           | Supply the receive header and raise bit `8` only once its transfer completes. WL drains receive records on bit `15`. |
| `finish_tx`          | `0x1F58`           | [Report transmit status](#transmit-completion) and raise bit `7`. WL reads the status on interrupt bit `29`.         |

[HLE frame reception](<index.md#hle-frame-reception>) describes how to deliver scan results through the receive FIFO.
