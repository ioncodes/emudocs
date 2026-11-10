# Wiimmfi

Wiimmfi replaces the Nintendo Wi-Fi Connection service. A console reaches it by using the Wiimmfi resolver at `95.217.77.181` as its DNS server. The resolver answers the Nintendo host names with Wiimmfi addresses and the game speaks the unchanged GameSpy protocols to those servers. This page describes the traffic Mario Kart Wii (`RMCE`, IOS36) exchanges with the service. The game reaches the network through the IOS [socket service](<Starlet/ios/so.md>).

## Name resolution

| Host name                                    | Answer                     |
| -------------------------------------------- | -------------------------- |
| `gpcm.gs.nintendowifi.net`                   | `95.217.77.151`            |
| `gpsp.gs.nintendowifi.net`                   | `95.217.77.151`            |
| `mariokartwii.master.gs.nintendowifi.net`    | `95.217.77.181`            |
| `naswii.nintendowifi.net`                    | `78.46.231.155`            |
| `mariokartwii.sake.gs.nintendowifi.net`      | `78.46.231.155`            |
| `gamestats.gs.nintendowifi.net`              | `195.201.236.139`          |
| `gamestats2.gs.nintendowifi.net`             | `195.201.236.139`          |
| `wiimmfi.de`                                 | `95.217.77.151`            |
| `ca.nas.wiimmfi.de`                          | `188.34.177.217`           |
| `main.nas.wiimmfi.de`                        | `188.34.177.217`           |
| `mariokartwii.available.gs.nintendowifi.net` | NXDOMAIN (response code 3) |

These addresses can change. The availability host name has no record, so the GameSpy availability check never receives a reply. The game retries the lookup a few times and then continues with the login.

When the same query is repeated within a few tens of milliseconds, the resolver answers with the truncated flag set. IOS then retries the query over TCP port 53 of its configured DNS server and uses that answer.

## Login

The game logs in through the following connections, in this order. Each connection goes to the address its host name resolves to in the table above.

1. An HTTPS (TCP port 443) authentication exchange with `naswii.nintendowifi.net`. It returns the `authtoken` used in the next step.
2. A GameSpy Presence Connection Manager (GPCM) login on TCP port 29900. The server opens with a challenge, the client logs in with the `authtoken` and the server accepts with a session key. The client then sends its status and updates its profile.

    ```text
    server: \lc\1\challenge\<challenge>\id\1\final\
    client: \login\challenge\<client challenge>\authtoken\NDS/<profile id>/...\partnerid\11\response\<md5>\firewall\1\port\0\productid\11059\gamename\mariokartwii\namespaceid\16\sdkrevision\3\quiet\0\id\1\final\
    server: \lc\2\sesskey\<session key>\proof\<md5>\userid\<id>\profileid\<id>\uniquenick\<nick>\lt\<login ticket>\id\1\final\
    client: \status\1\sesskey\<session key>\statstring\/SCM/1/SCN/0/VER/90\locstring\final\
    client: \updatepro\sesskey\<session key>\firstname\Wii:<console user id>@RMCE\partnerid\11\final\
    ```

3. A GameSpy Presence Search Player (GPSP) connection on TCP port 29901, used for `\otherslist\` lookups of friend profiles.
4. A GameSpy Query and Reporting 2 (QR2) heartbeat from the game's UDP socket to the master server on UDP port 27900. The game sends a 258 byte heartbeat with the server keys, the server answers with a 36 byte challenge, the game returns a 42 byte response and the server acknowledges with 15 bytes.
5. An HTTPS exchange with `mariokartwii.sake.gs.nintendowifi.net` and a second one with `naswii.nintendowifi.net`. The game then opens TCP port 443 on `wiimmfi.de`. Nothing accepts the connection and the game continues after its connect timeout.

## Server message after the heartbeat

About five seconds after the heartbeat acknowledgement, the master server sends a 3213 byte UDP datagram from port 27900 to the game socket that sent the heartbeat. It is a QR2 client message consisting of the bytes `FE FD 06`, a 4 byte key and a message body that contains PowerPC code and a Yaz0 block. The server repeats the datagram every three seconds until the game answers on the same socket with a 17 byte and a 159 byte datagram.

On a link with a 1500 byte MTU the datagram arrives as three IPv4 fragments with 1480, 1480 and 253 byte payloads. IOS [reassembles them](<Starlet/ios/so.md#ipv4-fragment-reassembly>) before delivering the datagram to the socket. A game that never receives the complete datagram never answers. It stays logged in but never enters a race or friend room.

## Friend registration

For every registered friend code the game sends this GPCM message:

```text
\addbuddy\sesskey\<session key>\newprofileid\<friend profile id>\reason\final\
```

When the friend has registered this console as well, the server answers with a `bm` type 4 authorization notice for that profile. A pending request from the other side would instead arrive as `bm` type 2 with a `|signed|` signature in its message. While the friend is online, the server also sends the friend's status with their public address and port.

```text
\bm\4\f\<friend profile id>\date\<unix time>\msg\final\
\bm\100\f\<friend profile id>\msg\|s|1|ss|<statstring>|ls|<locstring>|ip|<decimal IPv4>|p|<port>|qm|0\final\
```

The authorization notice makes the game request the friend's profile over GPCM. The `pi` reply is what converts the friend code entry into an established friend, so the roster shows the friend as registered only after it arrives. The game also sends a GPSP `\otherslist\` query for the same profile.

```text
client: \getprofile\sesskey\<session key>\profileid\<friend profile id>\id\<n>\final\
server: \pi\profileid\...\nick\...\uniquenick\...\final\
```

## Patch consent

The first time the player enters Worldwide, Regional or Find a Friend after the server message has arrived, the game shows a three page Wiimmfi notice and a dialog with the choices Permit and Prohibit. Permit makes the game resolve `ca.nas.wiimmfi.de` and `main.nas.wiimmfi.de`. It then opens HTTP (TCP port 80) and HTTPS (TCP port 443) connections to them and logs into GPCM and GPSP again. During this step the patched code reads the Broadway chip ID registers ECID_U, ECID_M and ECID_L (SPR 924 to 926).

The HTTPS server on `main.nas.wiimmfi.de` presents a single certificate issued by `Wiimmfi CA` with a 4096 bit RSA key. `naswii.nintendowifi.net` presents a chain of two certificates under `Nintendo CA` with 1024 bit RSA keys. The IOS [SSL](<Starlet/ios/ssl.md#montgomery-reduction>) module performs the RSA arithmetic for these handshakes.

!!! tip
    If at this stage you see gigantic performance issues it's very likely that it's Starlet doing a crapload of work for this math. It's genuinely insane how hard this bottlenecks throughput lol. You'll likely have to cache interpreter if not JIT Starlet or outright HLE this module.

Afterwards the server sends room status over the GPCM connection in these forms:

```text
\wiimmfi\status\pid\<profile id>\room\<room id>\region\<n>\np\<n>\name1\<base64>\name2\status\<n>\ol_status\<n>\ol_role\<n>\ol_slot\<n>\hs\<a>,<b>\time\<unix time>\final\
\wiimmfi\clear\pid\<profile id>\final\
```

## Matchmaking

While searching, Worldwide matchmaking repeatedly queries the server browser on TCP port 28910 of the GPCM host. NAT negotiation runs from the game's UDP socket to port 27901 on `95.217.77.151`, `78.46.231.155` and `188.34.177.217`. Their replies arrive on the same socket and all three servers must see the same public mapping of it. Peers then send UDP directly to the game socket, so the mapping must accept datagrams from endpoints the socket has not yet sent to.

### Friend room address exchange

Friend room setup carries match commands inside GPCM `bm` type 1 messages. The `msg` value starts with `GPCM90vMAT`, followed by one binary command byte and a Base64 payload. This encoding uses `.` instead of `+`, `-` instead of `/` and `*` for padding.

| Command | Name          | Address fields in the decoded payload                                                       |
| ------- | ------------- | ------------------------------------------------------------------------------------------- |
| `0x01`  | `RESERVATION` | Public IPv4 at `0x04`, public port at `0x08`, local IPv4 at `0x0C` and local port at `0x10` |
| `0x02`  | `RESV_OK`     | Public IPv4 at `0x0C`, public port at `0x10`, local IPv4 at `0x14` and local port at `0x18` |
| `0x06`  | `TELL_ADDR`   | Local IPv4 at `0x00` and local port at `0x04`                                               |

Each IPv4 field contains four bytes in network order. Each port occupies a little endian 32 bit field. The joining client sends `RESERVATION` and the room host answers with `RESV_OK`. `TELL_ADDR` supplies a local endpoint in an 8 byte payload. A reservation response and room status updates do not by themselves establish a UDP connection between the players.
