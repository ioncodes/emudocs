random PSX notes using `SCPH1000.BIN` and `SCPH1001.BIN`

## BIOS Stuck in Loop

Stubbed `GPUSTAT` (`0xFFFF_FFFF`) will eventually lead to this:

```mips
loc_8004FE44:
lw      $a4, 0($a1)
addiu   $v1, $v1, 1
xor     $a5, $v0, $a4
and     $a6, $a5, $a0
beq     $a6, $zero, loc_8004FE44
nop
```

where:  
* `a0` is `0x8000_0000`
* `a1` points to `GPUSTAT` register
* `v0` is original `GPUSTAT` value

Basically waits for bit 31 to change.

> *In 480-lines mode, bit31 changes per frame. And in 240-lines mode, the bit changes per scanline. The bit is always zero during Vblank (vertical retrace and upper/lower screen border).*

Seems to be 240-lines mode in my case. We get here because of the start of that routine:

```
sub_8004FE08:
lw      $v0, 0($a1)
bne     $a0, $zero, loc_8004FF00
lui     $at, 8
and     $t6, $v0, $at
beq     $t6, $zero, loc_8004FE64
nop
```

Roughly translates to (same register meaning as above):
```c
if ( (*GPUSTAT & 0x80000) != 0 ) {
  // Deadlock here...
}
```

It checks bit 19, if it's not 0 it will start waiting for something. This bit indicates vertical resolution:
* 0 = 240 lines (what it should be according to my emulator atm)
* 1 = 480 lines

So if the vertical resolution is 480 lines it will start waiting for a new frame presumably? Since the next bit change (bit 31) would be during VBLANK (???). Since `GPUSTAT` is stubbed it will always think we are in 480 lines mode. `0x1480_2000` seems to work better as an early stub (reset value?) but breaks the amidog CPU tests unless bit 27 which indicates VRAM to CPU DMA readiness is forcefully set as well.

Note: BIOS does swap to 480-lines mode eventually, so can't really escape it for long.
