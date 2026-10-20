write-gather pipe and DMA notes, mostly things that corrupt data **before** GX ever sees it. See [Games](<Games.md>) for the bugs these caused

## WPAR Reset

Gekko's [write-gather pipe](https://doc.kodewerx.org/documents/gekko_user_manual.pdf#page=314) combines stores into **32-byte bursts**. Games write to `0xCC008000` (physical `0x0C008000`, selected by WPAR) and PI writes each burst to RAM at its FIFO write pointer. Software can point PI somewhere else and disconnect GX's FIFO to build arrays in RAM.

> *A mtspr to WPAR invalidates the data in the buffer and sets the gather address.* [Source](https://doc.kodewerx.org/documents/gekko_user_manual.pdf#page=314)

Writing WPAR (SPR `921`) discards pending bytes **even if the address doesn't change**. Bytes already transferred stay in RAM. Without the reset, leftover bytes end up at the start of the next buffer and shift everything.

`GXRestoreWriteGatherPipe` writes **31 zero bytes** before restoring the FIFO: a partial burst has 1-31 useful bytes, so 31 zeros guarantee the useful tail leaves in a complete burst. The leftover padding is then discarded by the WPAR write. Order matters (pad, then reset)!

Fix ([commit](https://github.com/ioncodes/gecko/commit/9b6d7dc333b509df76b3550d7a1bf38606ac06cd)), needed in both interpreter and JIT runtime function:

```rust
921 => {
    sys.gekko.spr.wpar = val & !1; // bit 0 is BNE (read-only buffer status)
    sys.cp.gather_pos = 0;         // empty the pipe, no need to zero the buffer
}
```

Same commit also fixed redirection: PI must keep writing bursts to RAM while the CPU/GPU FIFOs are **disconnected**. Only the GX notification depends on the link:

```
write the complete burst to RAM
advance the PI write pointer

if the GPU FIFO is linked:
    update its write pointer and available byte count

retain only the incomplete tail for the next burst
```

## ARAM DMA

ARAM DMA works in 32-byte blocks. Main RAM address, ARAM address and length are all masked with `0x03FF_FFE0` (bit 31 of length is direction). Same masks as [Dolphin](https://github.com/dolphin-emu/dolphin/blob/9410094d9ff89a526ce353f5607245120321962c/Source/Core/Core/HW/DSP.cpp#L189-L197).

Games may write unaligned addresses on purpose and rely on the hardware ignoring the low bits.

Fix ([commit](https://github.com/ioncodes/gecko/commit/8c59b14298dedd827caa8de058048bb0b968dd82)):

```rust
const ARAM_DMA_MASK: u32 = 0x03ff_ffe0;

address = written_address & ARAM_DMA_MASK;
control = written_control & (0x8000_0000 | ARAM_DMA_MASK);
```

* Apply on every register write
* Apply on savestate load too (older states may contain unmasked values)
* Writing the lower half of the length register starts the transfer, upper half alone doesn't
