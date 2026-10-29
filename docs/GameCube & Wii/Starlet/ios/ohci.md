# OHCI

## Kernel USB initialization

Before the OHCI modules initialize their controllers, the kernel's `init_usb` (`0xFFFF6BD8`) writes `0xFE`, `0xF6`, `0xF4`, `0xF0`, `0x70`, `0x60`, `0x40` and finally `0x00` to physical address `0x0D800088`. Each write is 32 bits wide and followed by a delay.

## OH0 initialization

`ohci_core` (`0x138A00AC`) initializes the OH0 controller at `0x0D050000`. It writes `0x80000000` to `0x0D050014` then reads a 32 bit value from `0x0D050000` and checks its revision field.

| Bits  | Field    | Required value |
| ----- | -------- | -------------- |
| `7:0` | Revision | `0x10`         |

If the revision does not match, initialization reports `-4` through `ohci_core: OHCI initialization failed: %d` and takes the exit path before resetting the controller. The comparison ignores the upper 24 bits of the revision register.

### Controller state checks

Before requesting a host-controller reset, OH0 reads `HcControl` at `0x0D050004`:

| Bits  | Field             | Firmware use                                                |
| ----- | ----------------- | ----------------------------------------------------------- |
| `7:6` | Functional state  | Must be `0` before requesting reset.                        |
| `8`   | Interrupt routing | If set, OH0 requests ownership and the bit must then clear. |

If either check fails, initialization returns `-10`. The reset request alone cannot recover a controller left running by an earlier driver instance, so the USB block has to be reset before OH0 starts again.

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

## USB Command Format

USB commands are sent to the controller as this extremely cursed double nested linked list. Two linked lists are provided in `hcctrlhd` and `hcblkhd`, for Control transfers and Bulk transfers respectively.

For both `hcctrlhd` and `hcblkhd`, the first level of linked list contains `EndpointDescriptor`s. These are defined as:

Each endpoint descriptor occupies 16 bytes and is aligned to 16 bytes. Its words are little endian, and its pointers refer to physical addresses in guest RAM.

(The fields that are irrelevant for emulation have their descriptions omitted)

| Byte offset | Size    | Field           | Meaning                                                        |
| ----------- | ------- | --------------- | -------------------------------------------------------------- |
| `0x00`      | 4 bytes | `flags`         | Device address, endpoint number and transfer settings.          |
| `0x04`      | 4 bytes | `tail_pointer`  | Address of the dummy `TransferDescriptor` marking the end of the queue.           |
| `0x08`      | 4 bytes | `head_pointer`  | Address of the next `TransferDescriptor` to process, plus endpoint state bits.    |
| `0x0C`      | 4 bytes | `next_endpoint` | Address of the next `EndpointDescriptor`. Zero terminates the endpoint list.      |

The flags word contains:

| Bits    | Field                 | Meaning                                                                 |
| ------- | --------------------- | ----------------------------------------------------------------------- |
| `6:0`   | Device address        | USB address assigned to the device.                                     |
| `10:7`  | Endpoint number       | Endpoint on that device.                                                |
| `12:11` | Direction             | `1`: OUT. `2`: IN. `0` or `3`: use the direction provided by the `TransferDescriptor`s.               |
| `13`    | Low speed             |                         |
| `14`    | Skip                  |                             |
| `15`    | Isochronous           |          |
| `26:16` | Maximum packet size   |       |
| `31:27` | Reserved              |                                                          |

The head pointer word contains:

| Bits   | Field        | Meaning                                                        |
| ------ | ------------ | -------------------------------------------------------------- |
| `0`    | Halted       | Processing of this endpoint's `TransferDescriptor` queue has halted.              |
| `1`    | Toggle carry | Saved toggle for the next data packet: `0` means DATA0, `1` means DATA1. |
| `3:2`  | Reserved     | Reserved.                                                      |
| `31:4` | TD address   | Address bits `31:4` of the next `TransferDescriptor` to process.                    |

USB labels data packets DATA0 or DATA1 and alternates between them after each acknowledged packet. This lets the receiver recognize a retransmitted packet instead of accepting its data twice. See [OHCI section 4.3.1.3.4, Sequence Bits](https://ftp.zx.net.nz/pub/archive/ftp.compaq.com/pub/supportinformation/papers/hcir1_0a.pdf#page=36).

Mask off the low four bits when extracting descriptor addresses. The low four bits of `tail_pointer` and `next_endpoint` are reserved.

You keep going until `next_endpoint` is null. Each `EndpointDescriptor` contains within it another linked list, defined by `head_pointer` and `tail_pointer,` of `TransferDescriptor`s. Notably, `tail_pointer` is not the address of the last `TransferDescriptor` to process, it is a sentinel value. It is to be ignored once reached.

Logically, `EndpointDescriptor` can be thought of as a header that tells you what endpoint we are currently talking to, and how we're going to talk to it. `TransferDescriptor` then tells you "what" we're going to do it and what commands we want to do. A `TransferDescriptor` looks like this:

A general transfer descriptor occupies 16 bytes and is aligned to 16 bytes. Its words are little endian. Control, bulk and interrupt transfers use this layout; isochronous transfers use a different layout.

| Byte offset | Size    | Field                    | Meaning                                                              |
| ----------- | ------- | ------------------------ | -------------------------------------------------------------------- |
| `0x00`      | 4 bytes | `flags`                  | Direction, completion status and transfer settings.                   |
| `0x04`      | 4 bytes | `current_buffer_pointer` | Physical address of the next data byte. Zero means no bytes remain.   |
| `0x08`      | 4 bytes | `next_transfer`          | Physical address of the next `TransferDescriptor`. Bits `3:0` are reserved.             |
| `0x0C`      | 4 bytes | `buffer_end`             | Physical address of the last byte in the buffer, inclusive.           |

The flags word contains:

| Bits    | Field           | Meaning                                                                           |
| ------- | --------------- | --------------------------------------------------------------------------------- |
| `17:0`  | Reserved        | Reserved.                                                                         |
| `18`    | Buffer rounding | ???              |
| `20:19` | Direction       | `0`: SETUP. `1`: OUT. `2`: IN. `3`: reserved. Used when the ED defers to the TD.     |
| `23:21` | Interrupt delay | Completion interrupt delay in frames, `0`–`6`. `7` requests no interrupt for this TD. |
| `25:24` | Data toggle     | `0` or `1`: use the ED's toggle carry. `2`: DATA0. `3`: DATA1.                      |
| `27:26` | Error count     | Count of consecutive transaction errors.                                          |
| `31:28` | Condition code  | Transfer completion status.                                                       |

A condition code of zero indicates success to the IOS.

## Transfer completion

The controller walks the `EndpointDescriptor` list, processing each endpoint's `TransferDescriptor`s one by one. If a device needs more time, the current descriptor stays pending and is retried later. Other endpoints can still make progress.

When a `TransferDescriptor` completes, the controller writes its condition code, advances the endpoint's head pointer, and adds it to the done list.

Its interrupt-delay field controls when to notify software: `0` means the next USB frame boundary, `1`-`6` adds that many milliseconds, and `7` requests no notification of its own. Multiple completions can share one notification. To notify software, the controller writes the done-list pointer into `HCCA.done_head`, a field in a shared structure in memory, and raises the **Writeback Done Head** interrupt.

## Initial USB requests

IOS initializes the Bluetooth module through control transfers on endpoint `0`. The initial request types are:

| Request | Name                | Meaning |
| ------- | ------------------- | ------- |
| `5`     | `SET_ADDRESS`       | Assign the device a USB address. IOS assigns `1`; later `EndpointDescriptor`s use that address to select it. |
| `6`     | `GET_DESCRIPTOR`    | Read the device's identity and its available configuration, interfaces and endpoints. IOS can issue this request several times. |
| `9`     | `SET_CONFIGURATION` | Activate a configuration advertised by the device. IOS selects configuration `1`. |

Each request starts with an 8-byte request header in a `SETUP` `TransferDescriptor`. For `GET_DESCRIPTOR`, subsequent IN `TransferDescriptor`s receive the requested bytes, followed by an empty OUT transfer acknowledging completion. `SET_ADDRESS` and `SET_CONFIGURATION` have no data stage and finish with an empty IN transfer. The new USB address takes effect after that final transfer completes, and thus concludes initialization.
