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

## System Menu connection test

The System Menu's connection test runs on Broadway and exercises the zero-timeout poll path above. Function addresses in this section are Broadway effective addresses in the System Menu.

`connection_test_thread` (`0x813D8CC8`) calls `advance_connection_test` (`0x813D4764`) until it returns `4`. Between calls it sleeps for `((bus_clock >> 2) / 125000) >> 3` timebase ticks through `sleep_ticks` (`0x81535BCC`). At the 243 MHz bus clock this comes to 60 ticks, about one microsecond.

The test sends an HTTP request to `conntest.nintendowifi.net` and then runs the GameSpy availability check followed by the NAT checks. Each check waits for a reply through `socket_read_ready` (`0x813D6660`). It calls `poll_socket_ready` (`0x813D6540`) with a single 12 byte record, requested events `1` and a zero 64 bit timeout. The thread therefore issues IOCTL `0x0B` back to back until a reply arrives or a deadline expires. The deadlines come from `network_milliseconds` (`0x813D6838`), which divides the lower timebase word by `bus_clock / 4000`.

### Availability check

`advance_availability_check` (`0x813D6188`) resolves `wiinat.available.gs.nintendowifi.net` and sends a 12 byte UDP datagram to port 27900.

| Offset | Size    | Value                                   |
| ------ | ------- | --------------------------------------- |
| `0x00` | 5 bytes | `09 00 00 00 00`                        |
| `0x05` | 7 bytes | `wiinat` followed by a terminating zero |

The 7 byte reply `FE FD 09 00 00 00 00` completes the check. Without it the request is sent again 2000 ms later. If the second interval also expires without a valid reply, the check closes the socket and the test moves on.

### NAT checks

`advance_nat_checks` (`0x813D7B30`), `advance_nat_negotiation` (`0x813D78A4`) and `advance_nat_probe` (`0x813D74C8`) resolve the hosts `wiinat.natneg1.gs.nintendowifi.net`, `wiinat.natneg2.gs.nintendowifi.net` and `wiinat.natneg3.gs.nintendowifi.net`. They send seven 73 byte UDP datagrams to port 27901 from two sockets, all in the GameSpy NAT negotiation layout.

| Offset | Size     | Field     | Value                                         |
| ------ | -------- | --------- | --------------------------------------------- |
| `0x00` | 6 bytes  | Magic     | `FD FC 1E 66 6A B2`                           |
| `0x06` | 1 byte   | Version   | `3`                                           |
| `0x07` | 1 byte   | Type      | `0x0C` NATIFY request or `0x0A` address check |
| `0x08` | 4 bytes  | Cookie    | Big endian                                    |
| `0x0C` | 1 byte   | Port type | See below                                     |
| `0x0D` | 60 bytes | Payload   | Zero in requests                              |

The first socket sends three NATIFY requests and the second sends four address checks.

| Socket | Type   | Cookie       | Port type | Destination |
| ------ | ------ | ------------ | --------- | ----------- |
| First  | `0x0C` | `0x00000309` | `1`       | natneg1     |
| First  | `0x0C` | `0x00000309` | `2`       | natneg1     |
| First  | `0x0C` | `0x00000309` | `3`       | natneg2     |
| Second | `0x0A` | `0x00000000` | `1`       | natneg1     |
| Second | `0x0A` | `0x00000003` | `1`       | natneg1     |
| Second | `0x0A` | `0x00000001` | `2`       | natneg2     |
| Second | `0x0A` | `0x00000002` | `3`       | natneg3     |

`receive_nat_probe_replies` (`0x813D585C`) polls both sockets and consumes replies until all seven have arrived or 10000 ms have passed since the probe started. A NATIFY reply is the request sent back from its destination with the type byte changed to `0x02`. An address check reply is the request sent back with the type byte changed to `0x0B`. It also carries the sender's public IPv4 address at offset `0x0F` and its public port at offset `0x13` as a big endian 16 bit value.

The test reports success either way. Missing replies only make it wait out the deadlines, which add up to about 14 seconds. They also change the support code in the success dialog from 21212 to 11172.

!!! tip
    Answering the availability and NAT requests locally with the replies above lets the test finish within a few seconds instead of polling continuously until every deadline expires. The polling slows down the entire System Menu and not only the connection test dialog, so this improves performance everywhere.
