# SO

SO provides the IOS socket service.

## Thread records

`find_current_thread` (`0x13B5ADE8`) obtains the current IOS thread ID through [syscall](<index.md#syscalls>) `0x03`. It searches `g_network_threads` (`0x13B73D4C`) from its first record and returns the address of the record with a matching thread ID. If no record matches, it calls the assertion handler. These virtual addresses refer to IOS80.

The table holds 27 big endian records with a stride of 20 bytes.

| Offset | Size    | Field         | Meaning                                                   |
| ------ | ------- | ------------- | --------------------------------------------------------- |
| `0x00` | 4 bytes | Thread ID     | Index in the IOS kernel thread table                      |
| `0x04` | 4 bytes | Base priority | Priority restored when releasing the network lock         |
| `0x08` | 4 bytes | Last result   | Signed socket result for this thread                      |
| `0x0C` | 4 bytes | Next waiter   | Virtual pointer to the next thread record in a wait queue |

`register_network_thread` (`0x13B5AC14`) stores the supplied thread ID and base priority in the first record whose signed thread ID is not positive. `get_socket_result` (`0x13B4EEA4`) looks up the current thread's record and returns its last result.

## Network lock

`initialize_network_lock` (`0x13B5AD84`) creates a message queue with a capacity of one message and sends the message `0` to it. `g_network_lock_queue` (`0x13B73D44`) holds the queue ID. The queued message acts as the lock token.

`lock_network` (`0x13B5AD00`) checks the current thread's priority. If it is already 56, the function returns `0` without receiving a message or changing the priority. Otherwise it receives the token with blocking enabled, raises the current thread's priority to 56 and returns `1`.

`unlock_network` (`0x13B5AC3C`) returns `1` without changing any state if the current priority is not 56. Otherwise it finds the current thread's record, restores that record's base priority, sends the token back to the queue and returns `0`. `restore_network_lock` (`0x13B5AC88`) calls `unlock_network` when its argument is nonzero and `lock_network` when its argument is zero.

For a thread whose base priority differs from 56, an uncontended lock and unlock pair executes the following syscalls.

| Operation | Syscall sequence                                                                            |
| --------- | ------------------------------------------------------------------------------------------- |
| Acquire   | Get priority (`0x08`), receive message (`0x0E`), set priority (`0x09`)                      |
| Release   | Get priority (`0x08`), get thread ID (`0x03`), set priority (`0x09`), send message (`0x0C`) |

## Socket polling

`socket_worker` (`0x13B62238`) dispatches IOCTL operation `0x0B` to `poll_sockets` (`0x13B51850`). The output buffer holds an array of 12 byte big endian records. The record count is the buffer length divided by 12.

| Offset | Size    | Field             |
| ------ | ------- | ----------------- |
| `0x00` | 4 bytes | Socket descriptor |
| `0x04` | 4 bytes | Requested events  |
| `0x08` | 4 bytes | Returned events   |

The poll function accepts at most 24 records. It clears each returned-events field, retains valid socket objects and checks their readiness. It returns the number of records with a nonzero returned-events field. A zero timeout performs the readiness check without entering the wait queue, so the call returns `0` immediately if no socket is ready.

For one valid socket with a zero timeout, the normal path acquires and restores the network lock four times. It does so once to retain the socket, once to check readiness, once to release the protocol object's reference and once inside `release_socket_node` (`0x13B4F20C`). `release_socket_node` also looks up the current thread's record to store the node's last result there. When each lock restoration releases the lock, this path performs five thread record lookups in total.
