# IOS

IOS is the operating system that runs on Starlet. It provides the filesystem, ES (eTicket Services) and device drivers. [boot2](<../boot2.md>) loads IOS from the NAND filesystem. The loaded IOS starts its own kernel and modules, including the DI (Disc Interface) and OHCI (USB Open Host Controller Interface) drivers.

## IOS80 modules

IOS80 v6944 contains the following module tags in its embedded `IOSVersion` strings:

| Content ID   | Tag                                 |
| ------------ | ----------------------------------- |
| `0x00000001` | [DIP](<dip.md>)                     |
| `0x00000002` | [OH0](<ohci.md>)                    |
| `0x00000003` | [OH1](<ohci.md#oh1-initialization>) |
| `0x00000004` | SDI                                 |
| `0x00000005` | SO                                  |
| `0x00000006` | KD                                  |
| `0x00000007` | WD                                  |
| `0x00000010` | [WL](<wl.md>)                       |
| `0x00000009` | [NCD](<ncd.md>)                     |
| `0x0000000A` | ETH                                 |
| `0x0000000B` | STM                                 |
| `0x0000000C` | KBD                                 |
| `0x0000000D` | SSL                                 |
| `0x0000000E` | IOSP, FSP and ES                    |

## System Menu launch

boot2 selects the System Menu title `00000001-00000002` and loads its required IOS. It carries the launch request across the IOS reload in `/sys/launch.sys`. The file starts with an 8 byte big-endian title ID followed by a `0xD8` byte ticket view.

During startup, `es_worker` (`0x201015E8`) reads this file, obtains the title metadata and configures IPC access rights before calling `launch_title` (`0x20104CF4`). The title's boot content is passed to `load_executable` (`0xFFFF0E8C`). For a DOL, the loader clears BSS and loads the text and data sections into RAM.

`prepare_broadway` (`0xFFFF0E40`) installs the 64 byte `g_broadway_reset_stub` (`0xFFFF8880`) through EXI. The stub sets `SRR0` to `0x00003400`, clears `SRR1` and executes `rfi`. The loaded executable supplies the code at `0x00003400`.

| Address                           | Width         | Register             | IOS use                                     |
| --------------------------------- | ------------- | -------------------- | ------------------------------------------- |
| `0x0D800034`                      | 32 bits       | `HW_PPCIRQMASK`      | Enables the Broadway IPC interrupt.         |
| `0x0D800070`                      | 32 bits       | `HW_EXICTRL`         | Controls EXI access around boot-code setup. |
| `0x0D800180`                      | 32 bits       | `HW_DIFLAGS`         | Selects the uploaded boot code.             |
| `0x0D800194`                      | 32 bits       | `HW_RESETS`          | Sequences Broadway reset.                   |
| `0x0D806840` through `0x0D80687F` | 32 bit writes | EXI boot-code window | Holds 16 instruction words.                 |

| Register        | Bits  | Firmware operation                                                                   |
| --------------- | ----- | ------------------------------------------------------------------------------------ |
| `HW_PPCIRQMASK` | `30`  | Set before releasing Broadway.                                                       |
| `HW_EXICTRL`    | `0`   | Set while uploading the stub, cleared before reset release and set again afterwards. |
| `HW_DIFLAGS`    | `20`  | Set after uploading the stub.                                                        |
| `HW_RESETS`     | `5:4` | Both cleared first, then bit 5 is set and finally bit 4 is set.                      |

`reset_broadway` (`0xFFFF678C`) performs the reset sequence after loading the executable. The uploaded stub runs from Broadway's reset vector at `0xFFF00100` and transfers execution to the loaded title.

Once the System Menu is running, it uses DIP to [detect discs and read Disc Channel data](<dip.md#system-menu-disc-detection>).

## Thread waits

`receive_queued_message` (`0xFFFF2968`) blocks when the queue is empty and its nonblocking argument is zero. It marks the current thread as waiting and yields to the scheduler. After a successful wakeup, it checks the queue again before it reads a message.

Once the service threads are started, the initialization thread lowers its own priority to zero and enters an idle loop at `0xFFFF0C6A`. It polls `g_debug_requests` (`0xFFFF9ECC`). A nonzero value selects diagnostic output through `print_debug_state` (`0xFFFF6084`) then the loop clears the word.

For an undefined instruction that does not match the syscall encoding, `undefined_exception` (`0xFFFF1F24`) saves the exception return address, marks the current thread as faulted with state `6` and calls `dispatch_thread` (`0xFFFF2340`). The faulted thread is no longer runnable. The idle loop can therefore run while a service thread is faulted and other services are waiting for messages.

## IPC requests

Broadway requests IOS services through shared RAM and the IPC mailboxes. The request in RAM contains a command, a result field and command-specific arguments. The mailbox carries the request's physical address. File paths and transfer buffers are referenced by pointers in the request.

Broadway makes the request visible in RAM before writing its address to the request mailbox and signaling a new request through IPC control. An enabled IPC interrupt notifies Starlet. IOS acknowledges receipt separately from completing the operation, allowing Broadway to submit another request while earlier work remains pending.

IOS dispatches the request to the appropriate service. On completion, it supplies the result in shared RAM and publishes the reply pointer through the return mailbox. Broadway handles the reply interrupt, invalidates the relevant cache lines before reading the result and acknowledges the reply.

### Mailboxes and control flags

| Broadway physical address | Starlet physical address | Width   | Name      | IOS use                                           |
| ------------------------- | ------------------------ | ------- | --------- | ------------------------------------------------- |
| `0x0D000000`              | `0x0D800000`             | 32 bits | `PPCMSG`  | Physical address of a request from Broadway.      |
| `0x0D000004`              | `0x0D800004`             | 32 bits | `PPCCTRL` | Broadway's handshake flags and interrupt enables. |
| `0x0D000008`              | `0x0D800008`             | 32 bits | `ARMMSG`  | Physical address of a reply from IOS.             |

Starlet accesses `ARMCTRL` at `0x0D80000C`. The control registers expose the same four handshake flags at different bit positions:

| Flag | `PPCCTRL` bit | `ARMCTRL` bit | IOS protocol                                                                                     |
| ---- | ------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `X1` | `0`           | `2`           | Broadway signals a new request. IOS clears it by writing `1` to the `ARMCTRL` field.             |
| `X2` | `3`           | `1`           | Broadway acknowledges a reply. IOS clears it by writing `1` to the `ARMCTRL` field.              |
| `Y1` | `2`           | `0`           | IOS signals a reply. Broadway clears it by writing `1` to the `PPCCTRL` field.                   |
| `Y2` | `1`           | `3`           | IOS acknowledges receipt of a request. Broadway clears it by writing `1` to the `PPCCTRL` field. |

| Register  | Bit | Field | Interrupt enable                                          |
| --------- | --- | ----- | --------------------------------------------------------- |
| `PPCCTRL` | `4` | `IY1` | Reply notification through Hollywood interrupt `30`.      |
| `PPCCTRL` | `5` | `IY2` | Request acknowledgement through Hollywood interrupt `30`. |
| `ARMCTRL` | `4` | `IX1` | New request through Hollywood interrupt `31`.             |
| `ARMCTRL` | `5` | `IX2` | Reply acknowledgement through Hollywood interrupt `31`.   |

Writing a mailbox supplies its value. Software signals the corresponding control flag separately. Clearing `Y1` consumes the reply notification. Setting `X2` tells IOS that it can publish another queued reply.

Broadway sets `X1` or `X2` by writing `1` to the corresponding `PPCCTRL` field.

!!! tip
    Writing zero to `PPCCTRL` clears neither flag!! We tested this on hardware!!

### Startup notification

On success, `set_ipc_access_rights` (`0xFFFF2ED4`) writes `0x38` to `ARMCTRL` after updating the registered devices' access permissions. This enables `IX1` and `IX2` and sets `Y2`, as defined in the [control flag tables](#mailboxes-and-control-flags). The routine does not read a request from `PPCMSG` or publish a reply through `ARMMSG`. This startup notification can therefore assert `Y2` independently of request receipt.

### IOS reload

Broadway requests an IOS reload through `/dev/es` with IPC command `7` (`ioctlv`) and ES operation `0x08`. The request has two input vectors and no output vectors: an 8 byte title ID and a `0xD8` byte ticket view.

The old IOS acknowledges receipt with `Y2` before executing the reload. A successful reload does not return a normal `Y1` reply from the old IOS. The new IOS sets `Y2` again through its [startup notification](#startup-notification). These are two separate notifications: request receipt followed by initialization of the new IOS's IPC access rights.

### Request layout

The request header occupies 32 bytes. Its words are big endian and buffer pointers are physical addresses.

| Byte offset | Size     | Field                         | Meaning                                                                                                       |
| ----------- | -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `0x00`      | 4 bytes  | Command                       | Requested IOS operation.                                                                                      |
| `0x04`      | 4 bytes  | Result                        | Signed result returned by IOS.                                                                                |
| `0x08`      | 4 bytes  | Descriptor / original command | Input descriptor for operations on an open handle. IOS replaces it with the original command before dispatch. |
| `0x0C`      | 20 bytes | Arguments                     | Five command-specific words.                                                                                  |

For an open request, command `1` uses a path pointer at `0x0C` and a mode at `0x10`. IOS checks that the path terminates within 64 bytes. A successful open returns a nonnegative handle. A close request uses command `2` and supplies that handle at `0x08`.

## Broadway IPC worker

`ipc_worker` (`0xFFFF4ABC`) creates a queue with capacity for 50 messages and stores its handle in `g_ipc_queue` (`0xFFFFCE1C`). It registers hardware event `31` on that queue with a pointer to `g_ipc_event_message` (`0xFFFFCDFC`), whose value is `9`. It then waits for queue messages.

Before waiting, the worker reads `PPCCTRL`. If both `IY1` and `IY2` are clear, it writes zero to `PPCCTRL`. If either interrupt enable is set, it leaves `PPCCTRL` unchanged. The fields are defined in the [control flag tables](#mailboxes-and-control-flags).

`rearm_ipc_interrupt` (`0xFFFF5E2C`) clears the IPC interrupt flag and enables its mask. IPC uses bit `31` in [`HW_ARMIRQFLAG` and `HW_ARMIRQMASK`](<../index.md#arm-interrupts>).

On an IPC interrupt, `irq_handler` (`0xFFFF20D4`) clears the IPC mask bit, acknowledges the pending interrupt and calls `deliver_event` (`0xFFFF1FF4`) for event `31`. Event delivery appends the registered message to its queue and makes a waiting receiver runnable. An unregistered event or a full queue receives no message. Returning from the IRQ handler does not itself unmask IPC.

| Register                   | Bits | Worker use                                             |
| -------------------------- | ---- | ------------------------------------------------------ |
| ARM control (`0x0D80000C`) | `1`  | Handle Broadway's response acknowledgement.            |
| ARM control (`0x0D80000C`) | `2`  | Read a new Broadway request pointer from `0x0D800000`. |

For an event message with value `9`, the worker checks the control register. It checks response acknowledgement before a new request. When handling a new request, it reads the request pointer, updates the control register and rearms the interrupt before validating and dispatching the request.

If neither `X2` nor `X1` is set when the worker processes the event message, it returns to waiting for queue messages without rearming the IPC interrupt.

For a new request, it writes the preserved interrupt enables together with `0x0C` to `ARMCTRL`: clear `X1` and set `Y2`. If 47 requests are already pending, it writes `0x04` instead and withholds the receipt acknowledgement for the next request.

`queue_ipc_reply` (`0xFFFF4A0C`) places a completed request pointer in a ring with 48 entries. `send_ipc_reply` (`0xFFFF4994`) publishes a queued reply only when the reply mailbox is available. It flushes the 32 byte request header, writes the pointer to `ARMMSG` and sets `Y1` through `ARMCTRL`. It then marks the reply mailbox unavailable until Broadway signals `X2`.

Publishing a reply reduces the pending request count. When that count is 48 before publication, the control write also sets `Y2` to release the withheld receipt acknowledgement. The worker preserves `IX1` and `IX2` when it writes handshake flags.

## Timer alarm

`program_alarm` (`0xFFFF4190`) clamps the requested delay to at least two timer ticks. It reads [`HW_TIMER`](<../index.md#timer-alarm>) (`0x0D800010`) once and saves that sample in `g_last_timer_tick` (`0xFFFFCC14`). It adds the delay to the sample with 32 bit wraparound and writes the result to `HW_ALARM` (`0x0D800014`).

```c
delay_ticks = max(delay_ticks, 2)
now = HW_TIMER
g_last_timer_tick = now
HW_ALARM = (now + delay_ticks) & 0xFFFFFFFF
```

## AES completion

The AES service thread `aes_worker` (`0x13A741AC`) registers event `2` with message value `0` on its completion queue. It submits the AES command with the completion interrupt enabled and waits on that queue.

The kernel IRQ handler acknowledges the AES interrupt by writing `0x00000004` to [`HW_ARMIRQFLAG`](<../index.md#arm-interrupts>) (`0x0D800038`) and then delivers event `2`.

## SHA-1 completion

The SHA-1 service thread `sha_worker` (`0x13A746EC`) registers event `3` with message value `0` on its completion queue. `process_sha` (`0x13A7449C`) submits whole input blocks with the completion interrupt enabled and waits on that queue. For a single 64 byte block, it writes `0xC0000000` to the SHA-1 control register (`0x0D030000`).

The kernel IRQ handler acknowledges the SHA-1 interrupt by writing `0x00000008` to [`HW_ARMIRQFLAG`](<../index.md#arm-interrupts>) (`0x0D800038`) and then delivers event `3`.

## Syscalls

Syscalls are undefined ARM instructions. Executing one raises an Undefined Instruction exception and the vector at `0xFFFF0004` jumps to `undefined_exception`. The handler accepts the instruction word only if every bit outside the index field matches `0xE6000010`.

| Bits    | Field | Value                |
| ------- | ----- | -------------------- |
| `31:13` | Fixed | Same as `0xE6000010` |
| `12:5`  | Index | Syscall index        |
| `4:0`   | Fixed | Same as `0xE6000010` |

For example, `0xE6000130` selects index 9. Arguments are passed in `r0` through `r3` and the result is returned in `r0`. Execution then resumes at the instruction after the syscall. Indices above `0x7A` return immediately with `r0` unchanged.

| Index  | Function                             | Arguments                                                        | Result                                                       |
| ------ | ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `0x09` | `set_thread_priority` (`0xFFFF07B0`) | `r0` = thread ID (0 selects the current thread), `r1` = priority | `0` on success or `-4` if the thread or priority is rejected |
| `0x15` | `get_timer` (`0xFFFF4530`)           | None                                                             | Current 32 bit `HW_TIMER` value                              |
