# HackMii Installer

HackMii Installer 1.2 runs on Broadway and uses IOS services. It prepares the SD files used by [BootMii](<bootmii.md>). Function addresses on this page are Broadway effective addresses.

## SD files

Preparing the SD card writes these files:

| Path                      | Contents                   |
| ------------------------- | -------------------------- |
| `sd:/bootmii/armboot.bin` | MINI firmware for Starlet  |
| `sd:/bootmii/ppcboot.elf` | BootMii's Broadway payload |
| `sd:/bootmii/bootmii.ini` | BootMii configuration      |

## Mounting the SD card

`mount_sd` (`0x80020F8C`) calls `mount_fat` (`0x80024010`) then changes the current directory to `sd:/`.

| Result | Meaning                                               |
| ------ | ----------------------------------------------------- |
| `-1`   | FAT mounting failed.                                  |
| `-2`   | FAT mounting succeeded but changing directory failed. |

The FAT mount routine initializes the SD interface and checks whether a card is inserted before reading a volume. It accepts a FAT boot sector directly at sector zero, so an MBR is not required for that layout.

## Log flushing across IOS reload

`prepare_installer_ios` (`0x80010770`) flushes the log before and after reloading IOS. `flush_log` (`0x800224B4`) mounts the SD card then calls `write_sd_file` (`0x80021058`). If the file write fails, it returns `-2` without calling `unmount_sd` (`0x80020F50`). The SD initialization flag and handle remain set on this error path.

After the IOS reload, that retained initialization state can skip opening a fresh SD handle. `get_sd_status` (`0x80043EF4`) then queries the stale handle. `sd_is_inserted` (`0x80043F48`) tests bit 0 of the returned value:

| Bit | Use                                                              |
| --- | ---------------------------------------------------------------- |
| 0   | A set bit reports an inserted card. A clear bit reports no card. |

An IOS result of `-4` has bit 0 clear. The insertion check therefore fails and the next mount returns `-1` before reading sectors. [IOS SD write protection](<ios/sdi.md#write-protection>) can reject the earlier log write even when reads from the card succeed.
