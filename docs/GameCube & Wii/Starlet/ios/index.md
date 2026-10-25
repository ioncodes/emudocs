# IOS

IOS is the operating system that runs on Starlet. It provides the filesystem, ES (eTicket Services) and device drivers. [boot2](<../boot2.md>) loads IOS from the NAND filesystem. The loaded IOS starts its own kernel and modules, including the DI (Disc Interface) and OHCI (USB Open Host Controller Interface) drivers.

## IOS80 modules

IOS80 v6944 contains the following module tags in its embedded `IOSVersion` strings:

| Content ID   | Tag              |
| ------------ | ---------------- |
| `0x00000001` | DIP              |
| `0x00000002` | [OH0](<ohci.md>) |
| `0x00000003` | OH1              |
| `0x00000004` | SDI              |
| `0x00000005` | SO               |
| `0x00000006` | KD               |
| `0x00000007` | WD               |
| `0x00000010` | [WL](<wl.md>)    |
| `0x00000009` | NCD              |
| `0x0000000A` | ETH              |
| `0x0000000B` | STM              |
| `0x0000000C` | KBD              |
| `0x0000000D` | SSL              |
| `0x0000000E` | IOSP, FSP and ES |

## Thread waits

`receive_queued_message` (`0xFFFF2968`) blocks when the queue is empty and its nonblocking argument is zero. It marks the current thread as waiting and yields to the scheduler. After a successful wakeup, it checks the queue again before it reads a message.

Once the service threads are started, the initialization thread lowers its own priority to zero and enters an idle loop at `0xFFFF0C6A`. It polls `g_debug_requests` (`0xFFFF9ECC`). A nonzero value selects diagnostic output through `print_debug_state` (`0xFFFF6084`) then the loop clears the word.

For an undefined instruction that does not match the syscall encoding, `undefined_exception` (`0xFFFF1F24`) saves the exception return address, marks the current thread as faulted with state `6` and calls `dispatch_thread` (`0xFFFF2340`). The faulted thread is no longer runnable. The idle loop can therefore run while a service thread is faulted and other services are waiting for messages.

## IPC requests

Broadway requests IOS services through shared RAM and the IPC mailboxes. The request in RAM contains a command, a result field and command-specific arguments. The mailbox carries the request's physical address. File paths and transfer buffers are referenced by pointers in the request.

Broadway makes the request visible in RAM before writing its address to the request mailbox and signaling a new request through IPC control. An enabled IPC interrupt notifies Starlet. IOS acknowledges receipt separately from completing the operation, allowing Broadway to submit another request while earlier work remains pending.

IOS dispatches the request to the appropriate service. On completion, it supplies the result in shared RAM and publishes the reply pointer through the return mailbox. Broadway handles the reply interrupt, invalidates the relevant cache lines before reading the result and acknowledges the reply.

## Broadway IPC worker

`ipc_worker` (`0xFFFF4ABC`) creates a queue with capacity for 50 messages and stores its handle in `g_ipc_queue` (`0xFFFFCE1C`). It registers hardware event `31` on that queue with a pointer to `g_ipc_event_message` (`0xFFFFCDFC`), whose value is `9`. It then waits for queue messages.

`rearm_ipc_interrupt` (`0xFFFF5E2C`) clears the IPC interrupt flag and enables its mask. IPC uses bit `31` in [`HW_ARMIRQFLAG` and `HW_ARMIRQMASK`](<../index.md#arm-interrupts>).

| Register                   | Bits | Worker use                                             |
| -------------------------- | ---- | ------------------------------------------------------ |
| ARM control (`0x0D80000C`) | `1`  | Handle Broadway's response acknowledgement.            |
| ARM control (`0x0D80000C`) | `2`  | Read a new Broadway request pointer from `0x0D800000`. |

For an event message with value `9`, the worker checks the control register. It checks response acknowledgement before a new request. When handling a new request, it reads the request pointer, updates the control register and rearms the interrupt before validating and dispatching the request.

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

Syscalls are undefined ARM instructions. Executing one raises an Undefined Instruction exception and the vector at `0xFFFF0004` jumps to `syscall_handler` (`0xFFFF1D64`). The handler accepts the instruction word only if every bit outside the index field matches `0xE6000010`.

| Bits    | Field | Value                |
| ------- | ----- | -------------------- |
| `31:13` | Fixed | Same as `0xE6000010` |
| `12:5`  | Index | Syscall index        |
| `4:0`   | Fixed | Same as `0xE6000010` |

For example, `0xE6000130` selects index 9. Arguments are passed in `r0` through `r3` and the result is returned in `r0`. Execution then resumes at the instruction after the syscall. Indices above `0x77` return immediately with `r0` unchanged.

| Index  | Function                             | Arguments                                                        | Result                                                       |
| ------ | ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| `0x09` | `set_thread_priority` (`0xFFFF0794`) | `r0` = thread ID (0 selects the current thread), `r1` = priority | `0` on success or `-4` if the thread or priority is rejected |
