# NAND

All of this is written assuming a `HY27UF084G2M` NAND chip.

## Makeup

The NAND is made up of a list of clusters. Each cluster is made of 64 pages, and each page is made up of 2K (`0x800`) bytes, plus an additional spare 64 bytes. The spare can be used for various purposes, for example being able to tell if a block is bad, or detecting corruption using ECC. The first byte of the spare is `0xFF` iff the block is valid. The last 16 bytes of spare seem to contain the software-calculated ECC for the page.

!!! warning
    On startup, boot2 will do an initial scan of all blocks. For any blocks it detects are bad (by reading the first byte of spare), it will clear out the cluster.

## Reads

The NAND seems to have an internal buffer of size `0x840` - the exact length of a page plus its spare. Reads seem to follow two phases. First, read the data from the actual NAND storage into the internal buffer. Then, read the buffer out of the device, into the Starlet.

The Starlet will usually initiate three commands in quick succession when it wants to perform a read: 

1. `0x00` (Seems to move the requested page into the internal buffer)
2. `0x01` (ditto, but for the spare bytes?)
3. `0x30` (Read confirm - actually do the read)

This is all well and good. It would be, if the NAND interface wasn't written by a fucking dumbass. There's two buffers provided by the Starlet to the NAND interface - `NAND_DATABUF` and `NAND_ECCBUF`.

Well, actually **THREE** buffers, because there's a hidden third buffer at `NAND_ECCBUF ^ 0x40`. The three buffers operate in ways that defy logic:

1. The first `0x800` bytes that are read, whatever they may be, goes in `NAND_DATABUF`.
2. The next `0x40` bytes, if they are read, must be the spare. And so they go in `NAND_ECCBUF`. Notably, there is an issue in nomenclature and this should probably be called `NAND_SPAREBUF` but I digress.
3. And finally, `0x10` bytes of hardware-calculated ECC are written to `NAND_ECCBUF ^ 0x40`. 

!!! tip
    If you happen to be writing an emulator... just write the last 0x10 bytes of the spare out to NAND_ECCBUF ^ 0x40. Saves you from having to do an ECC calculation yourself :)
    <small> I honestly just discovered that I can create these cool Tip / Warning blocks and am getting a kick out of it.</small>

## Cluster Erases

There are two commands sent to erase stuff:

1. `0x60` (program in the cluster you want to erase)
2. `0xD0` (confirm, do the erase)

Boot2's `NAND_EraseCluster` function looks roughly like this:
```C
int NAND_EraseCluster(uint cluster) {
  int result;
  astruct_2 *iVar1;
  
  if (cluster < (uint)(1 << (_MAX_CLUSTERS - 14 & 0xff))) {
    // possibly NAND_Initialized?
    if (_DAT_20009000 == 0) {
      nand_status = -10;
    } else {
      _NAND_CONFIG = _NAND_CONFIG & 0x7fffffff;

      Nand_ProgramRowCol(-1, cluster << (0xeU - _DAT_2004f1a4 & 0xff));

      result = Nand_SendCommand(0x60, a1_through_5_requested_set_erase & 0x1c,0,0);
      if (result != 0) {
        // enable interrupts
        result = Nand_SendCommand(0xD0,0,0x40008000,0);
        if (result != 0) {
            result = Nand_ReadStatus();
        }
      }
    }
  } else {
    result = -4;
  }

  _NAND_CONFIG = _NAND_CONFIG | 0x80000000;

  // who knows, and honestly who cares
  FUN_13a10048(cluster,0,nand_status);

  return result;
}
```

## ReadStatus

Pretty simple. For NAND status, it seems like returning `0xE0` is good enough for `Boot2` to think that your commands have completed successfully.


