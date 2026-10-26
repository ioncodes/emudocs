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

### Frame timing

After reset completes, OH0 writes `0x27782EDF` to `HcFmInterval` (`0x0D050034`) using a 32 bit store. TODO: Figure out what the fuck this even does bro

| Bits    | Field   | Written value    | Meaning                                           |
| ------- | ------- | ---------------- | ------------------------------------------------- |
| `31`    | `FIT`   | `0`              | Frame interval toggle                             |
| `30:16` | `FSMPS` | `0x2778` (10104) | Initial largest data packet counter value in bits |
| `13:0`  | `FI`    | `0x2EDF` (11999) | Nominal frame interval encoding at 12 MHz         |

## OH1 initialization

OH1's `ohci_core` (`0x138B008C`) uses the controller at `0x0D060000`. It calls `register_device` (`0x138B2340`) to create a 4 entry request queue and register `/dev/usb/oh1` before checking the controller revision.

It writes `0x80000000` to `0x0D060014` then reads `0x0D060000` using 32 bit accesses. The revision must satisfy the same [revision-field requirement as OH0](#oh0-initialization). A mismatch reports initialization error `-4`, frees the controller structure and exits the thread before it enters the request loop.

### Root-hub power delay

`enumerate_devices` (`0x138B0934`) reads `HcRhDescriptorA` (`0x0D060048`) to determine the port count and power delay. After configuring power, it waits `POTPGT * 2000` microseconds through an IOS timer before checking the ports.

| Bits    | Field    | Meaning                          |
| ------- | -------- | -------------------------------- |
| `7:0`   | `NDP`    | Number of downstream ports.      |
| `31:24` | `POTPGT` | Power-on delay in units of 2 ms. |

## OH1 request dispatch

`usb_worker` (`0x138B239C`) waits on the registered request queue. Open and close operations return their result through an IOS reply before the worker receives another request.

For device transfer IOCTLV commands `0`, `1` and `2`, a nonnegative submission result returns the worker to its receive loop without replying to the request. Submission therefore does not itself complete the IPC operation. A negative submission result sends an immediate error reply.

### Transfer lengths

`submit_endpoint_transfer` (`0x138B15C0`) handles bulk command `1` and interrupt command `2`. Both require two input vectors and one output vector.

| Vector | Size            | Contents                                          |
| ------ | --------------- | ------------------------------------------------- |
| 0      | 1 byte          | Endpoint address.                                 |
| 1      | 2 bytes         | Transfer length as a big endian unsigned integer. |
| 2      | Transfer length | Data buffer.                                      |

The length in vector 1 must equal the size of vector 2. The endpoint and length pointers must be nonzero. A nonzero transfer length also requires a nonzero data pointer. Invalid vector counts or these validation failures return `-4`.

Control command `0` uses a different layout. `submit_control_transfer` (`0x138B14B4`) requires six input vectors and one output vector. Its transfer length is the LE 16 bit value in vector 4 and must equal the size of the data buffer in vector 6.
