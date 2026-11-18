# Library functions

Programs import firmware functions by library name and NID as described in [Executables](Executables.md#import-table). Arguments and results are listed in the order of the C prototype.

## ThreadManForUser

| NID          | Function                    | Arguments                                                              | Result                        |
| ------------ | --------------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| `0x446D8DE6` | `sceKernelCreateThread`     | `name`, `entry`, `init_priority`, `stack_size`, `attributes`, `option` | Thread ID                     |
| `0xF475845D` | `sceKernelStartThread`      | `thread_id`, `argument_size`, `argument_block`                         | 0                             |
| `0x809CE29B` | `sceKernelExitDeleteThread` | `exit_status`                                                          | Does not return               |
| `0x82826F70` | `sceKernelSleepThreadCB`    | none                                                                   | 0 once the thread is woken up |
| `0xE81CAF8F` | `sceKernelCreateCallback`   | `name`, `function`, `common`                                           | Callback ID                   |

### sceKernelCreateThread

`sceKernelCreateThread` creates a thread in the DORMANT state (see [Threads](Threads.md#thread-states)) with `init_priority` as its priority and allocates a stack of `stack_size` bytes. `entry` is the function the thread runs. The thread ends when `entry` returns and the return value becomes its exit status.

### sceKernelStartThread

`sceKernelStartThread` makes a DORMANT thread READY. It copies `argument_size` bytes from `argument_block` onto the thread's stack and calls `entry` with `argument_size` as the 1st argument and the address of the copy as the 2nd.

### sceKernelExitDeleteThread

`sceKernelExitDeleteThread` ends the calling thread and deletes it immediately.

### sceKernelSleepThreadCB

`sceKernelSleepThreadCB` puts the calling thread into WAIT until another thread wakes it up.

### sceKernelCreateCallback

`sceKernelCreateCallback` creates a callback owned by the calling thread from `function` and `common` and returns its ID.

## LoadExecForUser

| NID          | Function                        | Arguments     | Result |
| ------------ | ------------------------------- | ------------- | ------ |
| `0x4AC57943` | `sceKernelRegisterExitCallback` | `callback_id` | 0      |

`sceKernelRegisterExitCallback` registers the callback that runs when the user chooses to exit the game from the HOME menu.

## sceDisplay

| NID          | Function                | Arguments                                                       | Result |
| ------------ | ----------------------- | --------------------------------------------------------------- | ------ |
| `0x0E20F177` | `sceDisplaySetMode`     | `mode`, `width`, `height`                                       | 0      |
| `0x289D82FE` | `sceDisplaySetFrameBuf` | `frame_buffer`, `buffer_width`, `pixel_format`, `update_timing` | 0      |

`sceDisplaySetFrameBuf` sets the framebuffer the display shows. `frame_buffer` points to its top left pixel.

## sceGe_user

| NID          | Function            | Arguments | Result                                   |
| ------------ | ------------------- | --------- | ---------------------------------------- |
| `0xE47E40E4` | `sceGeEdramGetAddr` | none      | Physical address of the GE's local eDRAM |

`sceGeEdramGetAddr` returns the physical address at which the CPU reaches the graphics engine's local eDRAM. Used directly as a virtual address it lies in the cached user space (see [Address space](index.md#address-space)). Adding `0x40000000` gives the uncached view.
