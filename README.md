
https://github.com/user-attachments/assets/0d311ee0-5741-4f8a-9428-5cc759c8929b

# P2P — QR File Sharing

    **Send a file from your phone to your laptop (or any device to any device) directly, over an encrypted peer-to-peer connection. No account, no upload, no copy left on a server.**

    🔗 **Live:** [usep2p.vercel.app](https://usep2p.vercel.app)

    ---

    ## The Problem

    You've done this a hundred times: a photo on your phone needs to get to your laptop, so you WhatsApp it to yourself. Or you email it. Or you drop it in some "cloud" folder and pull it down on the other side.

    It works, but stop and think about what actually happened. Your file made a round trip through someone else's servers. WhatsApp recompressed your photo and kept a copy. The email provider has it indexed. The "temporary" cloud link is sitting in a bucket somewhere, retained on a schedule you never read. A simple device-to-device handoff quietly became *uploading your private data to a third party and trusting them to forget it.*

    The two devices are often **on the same desk**. Why should the bytes travel to a data center and back?

    **What if the file went straight from one device to the other — and nowhere else?**

    That's this project. The sender picks a file and gets a QR code plus a short code. The receiver scans or types it, and the file streams **directly between the two browsers** over an encrypted WebRTC channel. The server only introduces the two devices to each other — it never sees a single byte of the file.

    ---

    ## Brief Overview

    A **browser-only, accountless** file transfer tool. Open a tab, pick a file, share a code, done. Nothing to install.

    - **Direct device-to-device transfer** over a WebRTC `DataChannel` (SCTP over DTLS — reliable, ordered, and encrypted by default).
    - **The server never touches your file.** It's a *signaling* server only: it brokers the WebRTC handshake (SDP + ICE) and then steps out of the way.
    - **Ephemeral by design.** Sessions are in-memory, two-party, and expire on a TTL. No accounts, no database, no persistence, no analytics.
    - **QR-first.** Built for the phone-to-laptop case — scan and go.
    - **Works across networks.** STUN for NAT traversal, with a TURN relay fallback for the hard cases (symmetric NATs on mobile carriers, corporate Wi-Fi). Even when relayed, bytes stay DTLS-encrypted end to end.
    - **Integrity-checked.** Each chunk is SHA-256 hashed inline, and a Merkle-style root of the chunk hashes is compared at the end — so the received file is verified byte-for-byte without ever loading the whole thing into memory to hash it.

    ### Architecture

    Three layers, cleanly separated:

    ```
    ┌─────────────┐   WebSocket (signaling only)   ┌──────────────────┐
    │   Browser   │ ─────────── SDP / ICE ───────── │  Signaling server │
    │  (Sender)   │                                 │  Node + ws (Render)│
    └─────────────┘                                 └──────────────────┘
        │                                                  │
        │         WebRTC DataChannel (DTLS-encrypted)      │
        │  ══════════ file bytes flow directly ══════════  │ ← server never sees these
        ▼                                                  ▼
    ┌─────────────┐                                 ┌──────────────────┐
    │   Browser   │                                 │   STUN / TURN     │
    │  (Receiver) │ ─────── relay path (TURN) ───── │   (Metered.ca)    │
    └─────────────┘                                 └──────────────────┘
    ```

    | Layer | Tech | Role |
    |-------|------|------|
    | **Client** | React 18 + Vite, native WebRTC / Web Crypto, `qrcode.react` | UI, QR, chunking, hashing, transfer engine |
    | **Server** | Node (ESM) + `ws` + Express | Rendezvous: mint codes, relay handshake, expire sessions |
    | **Shared** | Plain JS modules | Signaling message contract + constants, imported by both ends |
    | **Transport** | WebRTC `DataChannel` | The actual data path — encrypted, reliable, peer-to-peer |

    **Monorepo** (npm workspaces): `client/`, `server/`, `shared/`.

    ### Deployment

    - **Frontend** → Vercel ([usep2p.vercel.app](https://usep2p.vercel.app))
    - **Signaling server** → Render ([p2p-share-server-vbhp.onrender.com](https://p2p-share-server-vbhp.onrender.com))
    - **STUN / TURN** → Metered.ca, with ephemeral credentials served by the backend (never baked into the shipped JS)

    ---

    ## My Approach + Problems

    The interesting part of this project wasn't getting two tabs on one laptop to talk — it was the pile of decisions that only reveal themselves once you take "direct, encrypted, works across networks, runs on a phone" seriously. A few of the ones that mattered:

    ### 1. Don't reinvent reliability the transport already gives you

    My first instinct (and the original plan) was a BitTorrent-style reliability layer on top of the channel: per-chunk ACKs, retransmit-on-failure, the works. **That was solving a problem that doesn't exist.** A WebRTC `DataChannel` runs SCTP over DTLS — it's *reliable and ordered by default*. Bytes can't arrive corrupted, out of order, or silently dropped.

    So I cut all of it. The transfer streams chunks in order, trusts the channel for delivery, and verifies correctness **once** at the end. The retransmit machinery, the in-flight tracking, the backward seeking through a sequential stream — all deleted before it was ever written. *The single biggest simplification was choosing not to build something.*

    ### 2. The receiver is a phone — so memory is the real enemy

    The naive receiver buffers every chunk in a `Map`, then builds one big `Blob`, then creates a download URL. That's **the whole file in memory twice** (~2× file size at peak). On a desktop, fine. On the phone that just scanned the QR code, a 2–4 GB file *reliably crashes mobile Safari.* And the phone is the headline use case, not an edge case.

    The fix was to **stream chunks straight to disk** as they arrive using the **File System Access API** (`showSaveFilePicker()` → `FileSystemWritableFileStream`), keeping memory flat regardless of file size.

    **Problem:** iOS Safari doesn't support the File System Access API at all. So there's a capability check up front: where streaming-to-disk is supported, use it; otherwise fall back to the in-memory Blob path **under a hard size cap**, with an early warning so the user finds out *before* the transfer starts, not after their browser dies. Same problem forced honesty in the UI: large files on iOS are explicitly called out as unsupported rather than silently failing.

    ### 3. "Works across networks" is a lie without TURN

    It's tempting to frame TURN as an optional nicety for ~20% of NATs. In reality, **symmetric NAT** — common on mobile carriers and corporate networks — makes a direct P2P connection *impossible*, and a TURN relay is the only way through. For a tool whose entire pitch is "share between two different networks," TURN isn't a fallback, it's required infrastructure.

    The honest tradeoff: when the relay path is used, file bytes *do* travel through the relay server — but they stay **DTLS-encrypted**, so "no one reads your file" still holds even if "zero relay bandwidth" doesn't. Credentials are **ephemeral and time-limited, served by the backend** at connect time, so they can't be scraped out of the frontend bundle and abused.

    ### 4. A guessable code is a session-hijack waiting to happen

    The short code is the only thing gating a session — it's a bearer token. A 4-char base36 code is ~1.7M combinations, brute-forceable over WebSocket in minutes, and whoever joins first *with the right code gets the file.*

    Mitigations, layered:
    - **6-char codes** (~2.1 billion combos), excluding visually ambiguous characters.
    - **Rate-limited joins** per IP and per code; sessions **locked to the first valid joiner**, third peers rejected outright.
    - A **sender-side approval gate**: when someone joins, the sender sees "a receiver connected — accept?" and *no metadata or bytes flow until they accept.* The code alone is never enough.

    ### 5. The constraints nobody mentions until they bite

    Peer-to-peer has inherent costs that are invisible until a transfer fails mysteriously:

    - **The sender's tab must stay open and awake** for the whole transfer — there's no server holding the file. So the UI says "keep this tab open," and requests a **screen wake lock** during an active transfer where available.
    - **Render's free tier cold-starts** (~30s to wake after 15 min idle). A user who scans a QR and stares at a blank screen for 30 seconds assumes it's broken. Mitigated with a **keep-alive ping** and a "waking up the server" UI state so a cold start reads as expected, not failure.
    - **Everything is driven by one explicit state machine** (`idle → signaling → connecting → connected → awaiting-approval → transferring → verifying → complete`, plus `failed(reason)` / `aborted`). Disconnects and ICE failures are *defined transitions*, not afterthoughts — so closing the sender mid-transfer shows a clear failure on the receiver instead of an infinite hang.

    ### 6. Make the hard parts testable in isolation

    Binary framing, hashing, and reassembly bugs are miserable to debug live across two browsers and a NAT. So the protocol, chunker, hasher, framing pack/unpack, and assembler are all **framework-agnostic pure modules** — unit-tested in Node with no DOM, no React, no network. The whole single-file engine is verified byte-for-byte through an in-memory channel stub before any of it touches a real connection.

    > One-line summary: *keep the simple architecture, trust the reliable channel instead of reimplementing reliability, stream to disk instead of buffering twice, treat TURN and the approval gate as first-class, and keep the protocol pure so it can be tested without a browser.*

    ---

    ## Project Structure

    ```
    p2p-share/
    ├── package.json          # npm workspaces: client, server, shared
    ├── vercel.json           # Vercel build config (client root)
    ├── shared/
    │   └── src/
    │       ├── signaling-messages.js   # signaling message types + validators
    │       └── constants.js            # code length, TTL, chunk size, watermarks
    ├── server/
    │   └── src/
    │       ├── index.js                # Express + ws signaling server
    │       ├── config.js               # port, TTL, origins, rate limits
    │       └── signaling/              # session manager, router, handlers
    └── client/
        └── src/
            ├── lib/                    # framework-agnostic engine
            │   ├── protocol.js         #   binary chunk framing
            │   ├── chunker.js          #   adaptive chunking
            │   ├── hasher.js           #   per-chunk SHA-256 + Merkle root
            │   ├── sender.js           #   sender engine + flow control
            │   ├── receiver.js         #   receiver engine + stream-to-disk
            │   ├── capabilities.js     #   File System Access detection
            │   ├── peerConnection.js   #   RTCPeerConnection lifecycle
            │   ├── signalingClient.js  #   WebSocket wrapper
            │   ├── connectionState.js  #   state machine
            │   └── iceConfig.js        #   STUN/TURN config fetch
            ├── hooks/                  # thin React wrappers over lib/
            ├── components/             # FilePicker, QRDisplay, AccessCodeEntry, TransferProgress
            └── pages/                  # Home, Sender, Receiver
    ```

    ---

    ## Development

    ```bash
    npm install            # wires all three workspaces

    npm run dev:server     # signaling server on :3001
    npm run dev:client     # Vite dev server

    npm test               # run the full test suite (Vitest)
    npm run lint
    ```

    ### Environment variables (client)

    The client falls back to the deployed Render server by default, but you can point it elsewhere:

    | Variable | Purpose | Default |
    |----------|---------|---------|
    | `VITE_WS_URL` | Signaling server WebSocket URL | `wss://p2p-share-server-vbhp.onrender.com` |
    | `VITE_ICE_CONFIG_URL` | Endpoint serving ICE (STUN/TURN) config | `https://p2p-share-server-vbhp.onrender.com/ice-config` |

    > **Note:** pages served over HTTPS must use `wss://` (secure WebSocket) — a plain `ws://` connection from an HTTPS page is blocked as mixed content.

    ---

    ## Status

    The single-file MVP is **complete and deployed end to end** — signaling server, WebRTC connection layer, transfer engine (chunker, hasher, sender, receiver, binary protocol), the full sender/receiver UI with QR and approval gate, and a live cross-network deployment with TURN relay.

    **Next:** multi-file sequential queue, then deferred work (resume-after-disconnect, short-authentication-string verification, unreliable-mode for raw speed).

    ---

    ## Assumptions & Constraints

    - **Single-instance** signaling server (in-memory sessions; no horizontal scaling).
    - **Exactly two parties** per session — one sender, one receiver.
    - Target browsers: modern desktop Chrome / Edge / Firefox and Chromium on Android. **iOS Safari** is supported but constrained (no stream-to-disk; large files capped).
    - Nothing is "uploaded." The sender selects a *local* file; the server never receives it.
