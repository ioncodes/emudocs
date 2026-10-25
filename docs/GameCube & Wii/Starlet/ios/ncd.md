# NCD

## Startup

`ncd_main` (`0x13D901E8`) waits 1000 ms before opening `/dev/net/wd/command` with mode `3`. If the open returns `-6`, it waits 10 ms and tries again. It uses `sleep_ms` (`0x13D962A0`), which creates a timer and blocks on a message queue until the timer delivers its message.

```c
sleep_ms(1000);
do {
    handle = open("/dev/net/wd/command", 3);
    if (handle == -6)
        sleep_ms(10);
} while (handle == -6);
```
