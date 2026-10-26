# DIP

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

`enable_cover_interrupt` (`0x202009C0`) reads `DICVR`, clears bits `2:1` in the value then sets bit `1` before writing it back. `disable_cover_interrupt` (`0x202009D4`) clears bits `2:1` in the read value before writing it back. Both avoid acknowledging an existing cover interrupt as a side effect of changing its enable. `acknowledge_cover` (`0x202009B0`) reads the register then writes the value with bit `2` set.
