# Homebrew Channel

Homebrew Channel runs on Broadway and uses IOS services. [BootMii](<bootmii.md#launching-installed-titles>) launches its installed title through boot2 and IOS.

## Startup hardware checks

In Homebrew Channel 1.1.2, `check_ios_access` (`0x81344698`) compares IOS results with direct hardware reads. Function addresses on this page are Broadway effective addresses.

`get_device_id` (`0x8138B044`) requests the device ID through ES ioctlv `7`. The startup routine then performs these accesses:

| Broadway effective address | Physical address | Access       | Check                                              |
| -------------------------- | ---------------- | ------------ | -------------------------------------------------- |
| `0xCD800064`               | `0x0D800064`     | 32 bit read  | Requires `HW_AHBPROT` to equal `0xFFFFFFFF`.       |
| `0xCD8001EC`               | `0x0D8001EC`     | 32 bit write | Writes `0x80000009` to select OTP word 9.          |
| `0xCD8001F0`               | `0x0D8001F0`     | 32 bit read  | Requires the OTP device ID to match the ES result. |
| `0xCD410008`               | `0x0D410008`     | 32 bit read  | Checks the IOS exception-vector instruction.       |
| `0xCD410028`               | `0x0D410028`     | 32 bit read  | Reads the exception handler address.               |

The routine also checks the instruction at the handler address through the [SRAM window](<index.md#sram-and-boot-rom-mapping>). These reads access the IOS code held in SRAM. The device-ID comparison uses the [OTP command and data registers](<index.md#otp-registers>).

## SD applications

An application directory under `sd:/apps/` can contain `boot.elf` and `meta.xml`. The browser uses the metadata for the application's name, author, version and descriptions. Selecting the application opens its details dialog. Selecting Load executes the application.

The Wii Remote D-pad and A button navigate the browser and its dialogs. Launching [HackMii Installer](<hackmii.md>) follows the same application-loading path.
