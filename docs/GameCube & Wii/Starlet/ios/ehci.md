# EHCI

## Service startup

The EHCI module in IOS58 provides `/dev/usb/ehc`. `ehci_worker` (`0x138C0E90`) creates a 64 message queue and registers the device before calling `init_ehci` (`0x138C1624`). It only enters the request loop if initialization succeeds.

If initialization fails, the worker prints `ehci_core: EHCI initialization failed` followed by `ehci_core exits...` and stops the thread. The device stays registered, so open requests can still be queued for it even though nothing will ever reply to them.

## Controller initialization

The capability registers start at physical address `0x0D040000` and the operational registers at `0x0D040010`.

`init_ehci` requires `USBSTS.HCHalted` to be set before it requests a controller reset and fails immediately if the bit is clear. It then sets `USBCMD.HCRESET`, waits two microseconds and checks whether the reset has completed. While the bit stays set it polls up to 100 more times, waiting one microsecond before each read.

| Physical address | Register | Bit | Field      | Firmware use                                  |
| ---------------- | -------- | --- | ---------- | --------------------------------------------- |
| `0x0D040010`     | `USBCMD` | 1   | `HCRESET`  | Set to request reset, then polled until clear |
| `0x0D040014`     | `USBSTS` | 12  | `HCHalted` | Must be set before requesting reset           |

Once the reset completes, the driver requires these exact register values and fails initialization on any mismatch:

| Physical address | Register        | Required value |
| ---------------- | --------------- | -------------- |
| `0x0D040010`     | `USBCMD`        | `0x00080000`   |
| `0x0D040014`     | `USBSTS`        | `0x00001000`   |
| `0x0D040018`     | `USBINTR`       | `0x00000000`   |
| `0x0D04001C`     | `FRINDEX`       | `0x00000000`   |
| `0x0D040020`     | `CTRLDSSEGMENT` | `0x00000000`   |
| `0x0D040050`     | `CONFIGFLAG`    | `0x00000000`   |

## Schedule control

`enable_async_schedule` (`0x138C49B8`) and `enable_periodic_schedule` (`0x138C4A24`) both go through `set_schedule` (`0x138C48FC`). Before changing an enable bit, this helper waits for the matching status bit to agree with the enable bit's current value. It returns `-10` if that wait times out. Both wrappers retry until the helper succeeds.

| Command register | Command bit | Status register | Status bit | Schedule     |
| ---------------- | ----------- | --------------- | ---------- | ------------ |
| `USBCMD`         | 5           | `USBSTS`        | 15         | Asynchronous |
| `USBCMD`         | 4           | `USBSTS`        | 14         | Periodic     |

## Port scan

`scan_ports` (`0x138C3448`) reads each port's status from `0x0D040050 + 4 * port`, with ports numbered from 1. It only runs port change handling for a port when one of these bits is set:

| Bits | Field                 |
| ---- | --------------------- |
| 1    | Connect status change |
| 3    | Port enable change    |

The scan disables the port change interrupt while it examines the ports. Before returning it acknowledges the pending port change status and enables the interrupt again.
