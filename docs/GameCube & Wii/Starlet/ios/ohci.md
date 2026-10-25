# OHCI

## OH0 initialization

`ohci_core` (`0x138A00AC`) initializes the OH0 controller at `0x0D050000`. It writes `0x80000000` to `0x0D050014` then reads a 32 bit value from `0x0D050000` and checks its revision field.

| Bits  | Field    | Required value |
| ----- | -------- | -------------- |
| `7:0` | Revision | `0x10`         |

If the revision does not match, initialization reports `-4` through `ohci_core: OHCI initialization failed: %d` and takes the exit path before resetting the controller. The comparison ignores the upper 24 bits of the revision register.

### Controller reset

After the revision and controller-state checks succeed, OH0 requests a reset through `0x0D050008`. It uses 32 bit accesses and preserves the other bits when setting the reset request.

| Bits | Field                 | Firmware use                                               |
| ---- | --------------------- | ---------------------------------------------------------- |
| 0    | Host controller reset | Set to request reset. Wait for the controller to clear it. |

OH0 calls `delay` (`0x138A0048`) with 10000 microseconds before checking completion. This helper restarts an IOS timer and waits for a message on its completion queue. If the reset request remains set, OH0 waits 2 microseconds between further checks for up to 10000 iterations. A request that remains set after those checks causes initialization to report `-10`.
