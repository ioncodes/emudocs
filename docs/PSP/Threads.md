# Threads

The kernel runs user code in threads and schedules them by priority.

## Thread States

| State        | Meaning                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| RUN          | The CPU is executing the thread. Only 1 thread is in this state at a time.   |
| READY        | The thread can run but waits because a thread of higher priority is running. |
| WAIT         | The thread stopped itself until a condition is met, such as sleep.           |
| DORMANT      | The thread has been created but not started.                                 |
| NON-EXISTENT | The thread has not been created yet or has already been deleted.             |

A new thread starts out DORMANT and becomes READY when it is started. When a thread continues after WAIT, it resumes where it stopped with its program counter and registers restored.

## Scheduling

A smaller priority value means a higher priority. The highest priority thread that is READY runs.
