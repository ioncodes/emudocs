random PSX notes using `SCPH1000.BIN` and `SCPH1001.BIN`

## Getting to Shell
In my testing a few things are required to be able to progress to the BIOS shell:

* Being at the diamond screen (duh...)
* Timer or at least forcing `0xFF` on reads
* VBLANK IRQ (kind of... without it I get stuck in a blue screen)
* CDROM with a few basic commands and IRQ

Note: unmapped reads return `0xFF` for me!! Depending on that value results may differ.

### CDROM Commands
The following commands seem to be required as a bare minimum:

```
cmd     subcmd  irq     result fifo
----------------------------------------------
0x01            INT3    Status
0x19    0x20    INT3    Get cdrom BIOS date/version (yy,mm,dd,ver)
```

### Further Notes & Code

* I return `[0x69, 0x69, 0x69, 0x69]` for the CDROM version
* I set *only* the "Shell Open" bit for status
* I send both "acknowledge" and "complete" IRQs (with an arbitrary 1000 cycle delay inbetween)
* I update parameter readiness bits on every tick

```rs
fn execute_command(&mut self, command: u8) {
    match command {
        // 0x01 	Nop 		INT3: status
        0x01 => {
            self.pending_command = Some(command);
            self.send_status(&[]);
            self.trigger_irq(DiskIrq::CommandAcknowledged);
        }
        // 0x19 	Test * 	sub, ... 	INT3: ...
        0x19 => {
            let subcommand = self.parameter_fifo.pop_front().unwrap();
            self.execute_subcommand(subcommand);
        }
        _ => {
            tracing::error!(
                target: "psx_core::cdrom",
                command = format!("{:02X}", command),
                "Unimplemented CDROM command",
            );
        }
    }

    self.address.set_busy_status(true);
}

fn execute_subcommand(&mut self, subcommand: u8) {
    match subcommand {
        0x20 => {
            self.result_fifo.push_back(0x69); // year
            self.result_fifo.push_back(0x69); // month
            self.result_fifo.push_back(0x69); // day
            self.result_fifo.push_back(0x69); // version
            self.trigger_irq(DiskIrq::CommandAcknowledged);
        }
    }
}

pub fn tick(&mut self, cycles: usize) {
    self.address.set_parameter_empty(self.parameter_fifo.is_empty());
    self.address.set_parameter_write_ready(self.parameter_fifo.len() < 16);
    self.cycles += cycles;

    if self.cycles >= CYCLE_DELAY {
        self.cycles -= CYCLE_DELAY;

        if let Some(command) = self.pending_command.take() {
            self.parameter_fifo.clear();
            self.address.set_busy_status(false);
            self.address.set_data_request(true);
            self.address.set_result_read_ready(true);

            self.trigger_irq(DiskIrq::CommandCompleted);
        }
    }
}
```

My TTY logs (VSync timeouts omitted):

```
INFO psx_core::tty:
INFO psx_core::tty: PS-X Realtime Kernel Ver.2.5
INFO psx_core::tty: Copyright 1993,1994 (C) Sony Computer Entertainment Inc.
INFO psx_core::tty: KERNEL SETUP!
INFO psx_core::tty:
INFO psx_core::tty: Configuration : EvCB       0x10            TCB     0x04
INFO psx_core::tty: System ROM Version 2.2 12/04/95 A
INFO psx_core::tty: Copyright 1993,1994,1995 (C) Sony Computer Entertainment Inc.
INFO psx_core::tty: ResetCallback: _96_remove ..
INFO psx_core::tty: System Controller ROM Version 69/69/69 69
INFO psx_core::tty: PS-X Control PAD Driver  Ver 3.0
```

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

```mips
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