# SEEPROM

SEEPROM is a serial EEPROM accessed through GPIO. boot1 uses it for version records and IOS reads it for console certificate data.

## GPIO connection

| Address      | Width   | Access | Name          | Purpose                              |
| ------------ | ------- | ------ | ------------- | ------------------------------------ |
| `0x0D8000E0` | 32 bits | R/W    | `HW_GPIO1OUT` | Chip select, clock and outgoing data |
| `0x0D8000E8` | 32 bits | R      | `HW_GPIO1IN`  | Incoming data                        |

| Register      | Bits | Name        | Description                |
| ------------- | ---- | ----------- | -------------------------- |
| `HW_GPIO1OUT` | 10   | Chip select | High during a transfer     |
| `HW_GPIO1OUT` | 11   | Clock       | Serial clock               |
| `HW_GPIO1OUT` | 12   | Data out    | Data sent to SEEPROM       |
| `HW_GPIO1IN`  | 13   | Data in     | Data received from SEEPROM |

For each outgoing bit, they lower the clock, assert chip select and set the data output before raising the clock. For each incoming bit, they lower the clock, assert chip select and raise the clock before sampling the input. They end a transfer by clearing chip select and issuing two clock pulses, leaving the clock low.

## Firmware commands

| Operation      | Command                            | Following transfer |
| -------------- | ---------------------------------- | ------------------ |
| Read word      | 11 bits: `0x600` OR `word_address` | Receive 16 bits    |
| Write word     | 11 bits: `0x500` OR `word_address` | Send 16 bits       |
| Enable writes  | 11 bits: `0x4C0`                   | None               |
| Disable writes | 11 bits: `0x400`                   | None               |

IOS enables writes before writing a record and disables them afterwards. After each word write, it ends the transfer then polls the input in groups of 10 bits. The last bit of each group indicates readiness. It ends the polling transfer when that bit is 1 or the retry limit is reached.

## Certificate data

IOS reads the following fields for the console certificate. Offsets are byte offsets within SEEPROM. Integer fields are big-endian.

| Offset | Size     | Contents                 |
| ------ | -------- | ------------------------ |
| `0x00` | 4 bytes  | MS identifier            |
| `0x04` | 4 bytes  | CA identifier            |
| `0x08` | 4 bytes  | NG key identifier        |
| `0x0C` | 60 bytes | NG certificate signature |

The MS and CA identifiers form the certificate issuer components. The NG device identifier comes from OTP, separately from the NG key identifier stored here. See [IOS certificate identity](<ios/index.md#certificate-identity>).

boot1's [version records](<boot1.md#seeprom-version-record>) begin at byte offset `0x48`.
