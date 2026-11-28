# Library Functions

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

| NID          | Function       | Arguments                                                           | Result                              |
| ------------ | -------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `0x109F50BC` | `sceIoOpen`    | `filename`, `flags`, `mode`                                         | File descriptor                     |
| `0x42EC03AC` | `sceIoWrite`   | `fd`, `data`, `size`                                                | Number of bytes written             |
| `0x54F5FB11` | `sceIoDevctl`  | `device`, `command`, `input`, `input_size`, `output`, `output_size` | Driver-dependent non-negative value |
| `0x55F4717D` | `sceIoChdir`   | `dirname`                                                           | 0                                   |
| `0x68963324` | `sceIoLseek32` | `fd`, `offset`, `whence`                                            | New byte offset from start of file  |
| `0x6A638D83` | `sceIoRead`    | `fd`, `buffer`, `size`                                              | Number of bytes read                |
| `0x810C4BC3` | `sceIoClose`   | `fd`                                                                | 0                                   |
| `0xB29DDF9C` | `sceIoDopen`   | `dirname`                                                           | Directory descriptor                |
| `0xEB092469` | `sceIoDclose`  | `fd`                                                                | 0                                   |

### sceIoOpen

`sceIoOpen` opens the file named `filename` with access and creation `flags`, applying `mode` as the file permissions when creating a new file. It returns a non-negative file descriptor on success or `SCE_ERROR_ERRNO_ENOENT` (`0x80010002`) when the file does not exist. A filename consists of a device name with its unit number, a colon and the path within that device, such as `host0:file.bin` or `disc0:/PSP_GAME/USRDIR/movie.pmf`. Omitting the unit number selects unit 0, so `tty:` refers to the same device as `tty0:`.

`flags` holds exactly 1 access mode, optionally combined with modifier bits. Devices may ignore or reject modifiers they do not support.

| Value        | Name           | Description                                                                |
| ------------ | -------------- | -------------------------------------------------------------------------- |
| `0x00000001` | `SCE_O_RDONLY` | Open for reading only                                                      |
| `0x00000002` | `SCE_O_WRONLY` | Open for writing only                                                      |
| `0x00000003` | `SCE_O_RDWR`   | Open for reading and writing                                               |
| `0x00000100` | `SCE_O_APPEND` | Perform every write at the end of the file                                 |
| `0x00000200` | `SCE_O_CREAT`  | Create the file if it does not exist                                       |
| `0x00000400` | `SCE_O_TRUNC`  | Discard the contents of a file opened for writing                          |
| `0x00000800` | `SCE_O_EXCL`   | Fail if the file already exists when combined with `SCE_O_CREAT`           |
| `0x01000000` | `SCE_O_FDEXCL` | Fail when a thread other than the opening thread uses the file descriptor  |
| `0x02000000` | `SCE_O_PWLOCK` | Prevent power state changes from the open until the file descriptor closes |

### sceIoRead

`sceIoRead` reads up to `size` bytes from the open file descriptor `fd` into `buffer` and returns the number of bytes read.

### sceIoWrite

`sceIoWrite` writes up to `size` bytes from `data` to the open file descriptor `fd` and returns the number of bytes written.

### sceIoDevctl

`sceIoDevctl` sends a driver-specific `command` to `device` with an `input_size` byte parameter buffer at `input` and an `output_size` byte response buffer at `output`.

### sceIoChdir

`sceIoChdir` changes the current directory of the device named in `dirname` and returns 0 on success.

### sceIoLseek32

`sceIoLseek32` moves the read and write position of file descriptor `fd` by the signed 32 bit `offset` relative to the origin selected by `whence` and returns the resulting 32 bit byte offset from the start of the file. It returns a negative error code such as `SCE_KERNEL_ERROR_BADF` (`0x80020323`) when `fd` is not an open descriptor or when the seek fails.

| Value | Name           | Origin                       |
| ----- | -------------- | ---------------------------- |
| 0     | `SCE_SEEK_SET` | Start of the file            |
| 1     | `SCE_SEEK_CUR` | Current position in the file |
| 2     | `SCE_SEEK_END` | End of the file              |

### sceIoClose

`sceIoClose` closes the file descriptor `fd` returned by `sceIoOpen`, returning 0 on success or `SCE_KERNEL_ERROR_BADF` (`0x80020323`) when `fd` is not open.

### sceIoDopen

`sceIoDopen` opens the directory `dirname` and returns a non-negative descriptor for listing its entries or `SCE_ERROR_ERRNO_ENOENT` (`0x80010002`) when the directory does not exist.

### sceIoDclose

`sceIoDclose` closes the directory descriptor `fd` returned by `sceIoDopen`, returning 0 on success or `SCE_KERNEL_ERROR_BADF` (`0x80020323`) when `fd` is not open.

## LoadExecForUser

| NID          | Function                        | Arguments     | Result |
| ------------ | ------------------------------- | ------------- | ------ |
| `0x4AC57943` | `sceKernelRegisterExitCallback` | `callback_id` | 0      |

`sceKernelRegisterExitCallback` registers the callback that runs when the user chooses to exit the game from the HOME menu.

## UtilsForUser

| NID          | Function                    | Arguments             | Result |
| ------------ | --------------------------- | --------------------- | ------ |
| `0x71EC4271` | `sceKernelLibcGettimeofday` | `timeval`, `timezone` | 0      |

`sceKernelLibcGettimeofday` writes the current time into the 8 byte `timeval` structure and returns 0.

| Offset | Size (bytes) | Description  |
| ------ | ------------ | ------------ |
| `0x00` | 4            | Seconds      |
| `0x04` | 4            | Microseconds |

## sceDisplay

| NID          | Function                    | Arguments                                                       | Result |
| ------------ | --------------------------- | --------------------------------------------------------------- | ------ |
| `0x0E20F177` | `sceDisplaySetMode`         | `mode`, `width`, `height`                                       | 0      |
| `0x289D82FE` | `sceDisplaySetFrameBuf`     | `frame_buffer`, `buffer_width`, `pixel_format`, `update_timing` | 0      |
| `0x984C27E7` | `sceDisplayWaitVblankStart` | none                                                            | 0      |

### sceDisplaySetMode

`sceDisplaySetMode` sets the display output `mode` (`0` for `SCE_DISPLAY_MODE_LCD`) and dimensions `width` (a multiple of 8) by `height` (see [Display](Display.md)). Switching modes outside vertical blanking blocks until the start of the next vertical blanking interval.

### sceDisplaySetFrameBuf

`sceDisplaySetFrameBuf` configures the displayed framebuffer, where `frame_buffer` points to the top left pixel (or NULL with `buffer_width` set to 0 to black out the screen), `buffer_width` gives the row stride in pixels as a multiple of 64, `pixel_format` selects the pixel layout and `update_timing` chooses whether the change takes effect on the next horizontal sync (`0`) or next vertical blanking interval (`1`) (see [Display](Display.md#framebuffer)).

### sceDisplayWaitVblankStart

`sceDisplayWaitVblankStart` places the calling thread in the WAIT state until the start of the next vertical blanking interval, even if vertical blanking is already in progress, without executing thread callbacks during the wait.

## sceGe_user

| NID          | Function                   | Arguments                             | Result                                   |
| ------------ | -------------------------- | ------------------------------------- | ---------------------------------------- |
| `0xA4FC06A4` | `sceGeSetCallback`         | `callback_data`                       | Callback ID                              |
| `0xAB49E76A` | `sceGeListEnQueue`         | `list`, `stall`, `callback_id`, `opt` | Display list ID                          |
| `0xE0D68148` | `sceGeListUpdateStallAddr` | `list_id`, `stall`                    | 0                                        |
| `0xE47E40E4` | `sceGeEdramGetAddr`        | none                                  | Physical address of the GE's local eDRAM |

### sceGeEdramGetAddr

`sceGeEdramGetAddr` returns the physical address at which the CPU reaches the graphics engine's local eDRAM. Used directly as a virtual address it lies in the cached user space (see [Address Space](index.md#address-space)). Adding `0x40000000` gives the uncached view.

### sceGeListEnQueue

`sceGeListEnQueue` appends a display list starting at `list` to the graphics engine queue and returns a non-negative display list ID, with up to 63 lists queued simultaneously (see [Graphics Engine](GE.md#display-lists)). Execution pauses when the read address reaches `stall` or runs without stalling when `stall` is NULL. Passing a valid `callback_id` from `sceGeSetCallback` attaches its signal and finish handlers to the list while a negative value disables callbacks. `opt` optionally points to a `SceGeListOptParam` structure for context saving or extended signal call stacks (or NULL when neither is needed).

### sceGeListUpdateStallAddr

`sceGeListUpdateStallAddr` updates the stall address of the queued display list `list_id` to `stall` and returns 0. If the list is already running it overwrites the hardware stall register immediately, while for a list that has not started yet it updates the initial stall address.

### sceGeSetCallback

`sceGeSetCallback` registers a pair of graphics engine interrupt handlers described by the 16 byte `SceGeCbParam` structure at `callback_data` and returns a non-negative callback ID. Up to 16 callback sets can be registered simultaneously.

| Offset | Size (bytes) | Description                   |
| ------ | ------------ | ----------------------------- |
| `0x00` | 4            | Signal callback function      |
| `0x04` | 4            | Signal callback user argument |
| `0x08` | 4            | Finish callback function      |
| `0x0C` | 4            | Finish callback user argument |

When a display list completes a `FINISH` followed by `END` and has a non-null finish callback, the kernel invokes that handler in interrupt context with the low 16 bits of the `FINISH` command as the 1st argument, the registered user argument as the 2nd and the display list address where the list ended as the 3rd.

## sceCtrl

| NID          | Function                    | Arguments           | Result                 |
| ------------ | --------------------------- | ------------------- | ---------------------- |
| `0x1F803938` | `sceCtrlReadBufferPositive` | `pad_data`, `count` | Number of samples read |

`sceCtrlReadBufferPositive` reads up to `count` (1 to 64) unread controller samples into the `SceCtrlData` array at `pad_data` in positive logic, advancing the service read pointer across its 64 sample buffer (see [Controller](Controller.md)). If no new sample has been recorded since the previous read, the calling thread blocks until the next sample arrives, so a successful call always returns between 1 and `count`.

## sceUtility

| NID          | Function                      | Arguments     | Result |
| ------------ | ----------------------------- | ------------- | ------ |
| `0xA5DA2406` | `sceUtilityGetSystemParamInt` | `id`, `value` | 0      |

`sceUtilityGetSystemParamInt` reads the integer system parameter selected by `id` and writes it to `value`.
