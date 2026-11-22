# Library functions

Programs import firmware functions by library name and NID as described in [Executables](Executables.md#import-table). Arguments and results are listed in the order of the C prototype.

## ThreadManForUser

| NID          | Function                     | Arguments                                                              | Result                        |
| ------------ | ---------------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| `0x446D8DE6` | `sceKernelCreateThread`      | `name`, `entry`, `init_priority`, `stack_size`, `attributes`, `option` | Thread ID                     |
| `0xF475845D` | `sceKernelStartThread`       | `thread_id`, `argument_size`, `argument_block`                         | 0                             |
| `0x809CE29B` | `sceKernelExitDeleteThread`  | `exit_status`                                                          | Does not return               |
| `0x82826F70` | `sceKernelSleepThreadCB`     | none                                                                   | 0 once the thread is woken up |
| `0x293B45B8` | `sceKernelGetThreadId`       | none                                                                   | Thread ID                     |
| `0x17C1684E` | `sceKernelReferThreadStatus` | `thread_id`, `info`                                                    | 0                             |
| `0xE81CAF8F` | `sceKernelCreateCallback`    | `name`, `function`, `common`                                           | Callback ID                   |
| `0x19CFF145` | `sceKernelCreateLwMutex`     | `work`, `name`, `attributes`, `init_count`, `option`                   | 0                             |
| `0x60107536` | `sceKernelDeleteLwMutex`     | `work`                                                                 | 0                             |
| `0xD6DA4BA1` | `sceKernelCreateSema`        | `name`, `attributes`, `init_count`, `max_count`, `option`              | Semaphore ID                  |
| `0x4E3A1105` | `sceKernelWaitSema`          | `semaphore_id`, `need_count`, `timeout`                                | 0                             |
| `0x3F53E640` | `sceKernelSignalSema`        | `semaphore_id`, `signal_count`                                         | 0                             |

### sceKernelCreateThread

`sceKernelCreateThread` creates a thread in the DORMANT state (see [Threads](Threads.md#thread-states)) with `init_priority` as its priority and allocates a stack of `stack_size` bytes. `entry` is the function the thread runs. The thread ends when `entry` returns and the return value becomes its exit status.

### sceKernelStartThread

`sceKernelStartThread` makes a DORMANT thread READY. It copies `argument_size` bytes from `argument_block` onto the thread's stack and calls `entry` with `argument_size` as the 1st argument and the address of the copy as the 2nd.

### sceKernelExitDeleteThread

`sceKernelExitDeleteThread` ends the calling thread and deletes it immediately.

### sceKernelSleepThreadCB

`sceKernelSleepThreadCB` puts the calling thread into WAIT until another thread wakes it up.

### sceKernelGetThreadId

`sceKernelGetThreadId` returns the thread ID of the calling thread.

### sceKernelReferThreadStatus

`sceKernelReferThreadStatus` writes the status of `thread_id` (or the calling thread when `thread_id` is 0) into the structure at `info`. The caller must set the structure's `size` field to its byte size before calling.

### sceKernelCreateCallback

`sceKernelCreateCallback` creates a callback owned by the calling thread from `function` and `common` and returns its ID.

### sceKernelCreateLwMutex

`sceKernelCreateLwMutex` initializes a lightweight mutex in the caller-supplied work area at `work` with an initial lock count of `init_count`. When `init_count` is positive the calling thread owns the mutex immediately. When `init_count` is 0 the mutex starts unlocked.

### sceKernelDeleteLwMutex

`sceKernelDeleteLwMutex` deletes the lightweight mutex at `work`. Any threads waiting on it are woken with an error.

### sceKernelCreateSema

`sceKernelCreateSema` creates a semaphore with initial count `init_count` and maximum count `max_count` and returns its ID.

### sceKernelWaitSema

`sceKernelWaitSema` waits until `need_count` resources can be acquired from `semaphore_id`. When `timeout` is non-null it points to a maximum wait time in microseconds that is updated with the remaining time on return. A null `timeout` waits indefinitely.

### sceKernelSignalSema

`sceKernelSignalSema` adds `signal_count` resources to `semaphore_id`. If adding them would exceed the semaphore's maximum count, the count stays unchanged and an error is returned.

## Kernel_Library

| NID          | Function                 | Arguments                       | Result |
| ------------ | ------------------------ | ------------------------------- | ------ |
| `0xBEA46419` | `sceKernelLockLwMutex`   | `work`, `lock_count`, `timeout` | 0      |
| `0x15B6446B` | `sceKernelUnlockLwMutex` | `work`, `unlock_count`          | 0      |

### sceKernelLockLwMutex

`sceKernelLockLwMutex` acquires the lightweight mutex at `work` and increases its lock count by `lock_count`. When `timeout` is non-null it points to a maximum wait time in microseconds that is updated with the remaining time on return. A null `timeout` waits indefinitely.

### sceKernelUnlockLwMutex

`sceKernelUnlockLwMutex` decreases the lock count of the lightweight mutex at `work` by `unlock_count` and releases the mutex when the count reaches 0. If the count would go negative, it stays unchanged and an error is returned.

## SysMemUserForUser

| NID          | Function                        | Arguments                                         | Result                                     |
| ------------ | ------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| `0x237DBD4F` | `sceKernelAllocPartitionMemory` | `partition_id`, `name`, `type`, `size`, `address` | Memory block ID                            |
| `0xB6D61D02` | `sceKernelFreePartitionMemory`  | `block_id`                                        | 0                                          |
| `0x9D9A5BA1` | `sceKernelGetBlockHeadAddr`     | `block_id`                                        | Start address of the block or 0 on failure |
| `0xA291F107` | `sceKernelMaxFreeMemSize`       | none                                              | Size of the largest free block in bytes    |

### sceKernelAllocPartitionMemory

`sceKernelAllocPartitionMemory` allocates a block of `size` bytes from partition `partition_id` (partition 2 is user memory) and returns its block ID. `type` selects placement - 0 allocates from the low end, 1 from the high end, 2 at the fixed `address`, 3 from the low end aligned to `address` and 4 from the high end aligned to `address`.

### sceKernelFreePartitionMemory

`sceKernelFreePartitionMemory` frees the memory block identified by `block_id`.

### sceKernelGetBlockHeadAddr

`sceKernelGetBlockHeadAddr` returns the start address of the memory block identified by `block_id` or 0 when the ID is invalid or has already been freed.

### sceKernelMaxFreeMemSize

`sceKernelMaxFreeMemSize` returns the size in bytes of the largest contiguous free region in the user allocatable memory area.

## IoFileMgrForUser

| NID          | Function      | Arguments                                                           | Result                              |
| ------------ | ------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `0x109F50BC` | `sceIoOpen`   | `filename`, `flags`, `mode`                                         | File descriptor                     |
| `0x42EC03AC` | `sceIoWrite`  | `fd`, `data`, `size`                                                | Number of bytes written             |
| `0x54F5FB11` | `sceIoDevctl` | `device`, `command`, `input`, `input_size`, `output`, `output_size` | Driver-dependent non-negative value |

### sceIoOpen

`sceIoOpen` opens the file named `filename` with access and creation `flags` and returns a non-negative file descriptor. `mode` sets the file permissions when creating a new file.

### sceIoWrite

`sceIoWrite` writes up to `size` bytes from `data` to the open file descriptor `fd` and returns the number of bytes written.

### sceIoDevctl

`sceIoDevctl` sends a driver-specific `command` to `device` with an `input_size` byte parameter buffer at `input` and an `output_size` byte response buffer at `output`.

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

`sceDisplaySetFrameBuf` sets the framebuffer the display shows. `frame_buffer` points to its top left pixel and `buffer_width` gives its row stride in pixels as a multiple of 64.

## sceGe_user

| NID          | Function            | Arguments | Result                                   |
| ------------ | ------------------- | --------- | ---------------------------------------- |
| `0xE47E40E4` | `sceGeEdramGetAddr` | none      | Physical address of the GE's local eDRAM |

`sceGeEdramGetAddr` returns the physical address at which the CPU reaches the graphics engine's local eDRAM. Used directly as a virtual address it lies in the cached user space (see [Address space](index.md#address-space)). Adding `0x40000000` gives the uncached view.

## sceUtility

| NID          | Function                      | Arguments     | Result |
| ------------ | ----------------------------- | ------------- | ------ |
| `0xA5DA2406` | `sceUtilityGetSystemParamInt` | `id`, `value` | 0      |

`sceUtilityGetSystemParamInt` reads the integer system parameter selected by `id` and writes it to `value`.
