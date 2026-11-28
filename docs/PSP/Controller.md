# Controller

The controller service samples the digital buttons and analog stick and keeps a buffer of the 64 most recent samples. Programs read buffered samples through `sceCtrl` (see [Library functions](Libraries.md#scectrl)). By default the service operates in digital-only mode (`0`), where only digital buttons are sampled, while switching to digital and analog mode (`1`) also samples the analog stick.

## SceCtrlData

Each sample is stored in a 16 byte `SceCtrlData` structure. The analog stick axes span `0x00` to `0xFF` with `0x80` (128) as the center position.

| Offset | Size (bytes) | Field       | Description                                                    |
| ------ | ------------ | ----------- | -------------------------------------------------------------- |
| `0x00` | 4            | `TimeStamp` | Sample timestamp in microseconds                               |
| `0x04` | 4            | `Buttons`   | 32 bit button state bitfield                                   |
| `0x08` | 1            | `Lx`        | Analog stick X axis (`0x00` left, `0x80` center, `0xFF` right) |
| `0x09` | 1            | `Ly`        | Analog stick Y axis (`0x00` top, `0x80` center, `0xFF` bottom) |
| `0x0A` | 6            | `Rsrv`      | Reserved                                                       |

## Button bitfield

In positive logic (returned by `sceCtrlReadBufferPositive`), a 1 bit means the button or state is active.

| Bits | Name                   | Description                                     |
| ---- | ---------------------- | ----------------------------------------------- |
| 0    | `SCE_CTRL_SELECT`      | SELECT button                                   |
| 3    | `SCE_CTRL_START`       | START button                                    |
| 4    | `SCE_CTRL_UP`          | D-pad up                                        |
| 5    | `SCE_CTRL_RIGHT`       | D-pad right                                     |
| 6    | `SCE_CTRL_DOWN`        | D-pad down                                      |
| 7    | `SCE_CTRL_LEFT`        | D-pad left                                      |
| 8    | `SCE_CTRL_L`           | L shoulder button                               |
| 9    | `SCE_CTRL_R`           | R shoulder button                               |
| 12   | `SCE_CTRL_TRIANGLE`    | Triangle button                                 |
| 13   | `SCE_CTRL_CIRCLE`      | Circle button                                   |
| 14   | `SCE_CTRL_CROSS`       | Cross button                                    |
| 15   | `SCE_CTRL_SQUARE`      | Square button                                   |
| 16   | `SCE_CTRL_INTERCEPTED` | Controller input intercepted by system software |
| 17   | `SCE_CTRL_HOLD`        | HOLD switch engaged                             |
