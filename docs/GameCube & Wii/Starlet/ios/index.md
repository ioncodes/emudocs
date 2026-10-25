# IOS

IOS is the operating system that runs on Starlet. It provides the filesystem, ES (eTicket Services) and device drivers. [boot2](<../boot2.md>) loads IOS from the NAND filesystem. The loaded IOS starts its own kernel and modules, including the DI (Disc Interface) and OHCI (USB Open Host Controller Interface) drivers.

## IOS80 modules

IOS80 v6944 contains the following module tags in its embedded `IOSVersion` strings:

| Content ID   | Tag                  |
| ------------ | -------------------- |
| `0x00000001` | DIP                  |
| `0x00000002` | [OH0](<ohci.md>) |
| `0x00000003` | OH1                  |
| `0x00000004` | SDI                  |
| `0x00000005` | SO                   |
| `0x00000006` | KD                   |
| `0x00000007` | WD                   |
| `0x00000010` | WL                   |
| `0x00000009` | NCD                  |
| `0x0000000A` | ETH                  |
| `0x0000000B` | STM                  |
| `0x0000000C` | KBD                  |
| `0x0000000D` | SSL                  |
| `0x0000000E` | IOSP, FSP and ES     |

## Thread waits

`receive_queued_message` (`0xFFFF27A8`) blocks when the queue is empty and its nonblocking argument is zero. It marks the current thread as waiting and yields to the scheduler. After a successful wakeup, it checks the queue again before it reads a message.

Once the service threads are started, the initialization thread lowers its own priority to zero and enters an idle loop at `0xFFFF0C4E`. The loop keeps reading the word at `0xFFFF9C8C` for as long as that word is zero.

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
