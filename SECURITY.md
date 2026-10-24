# Security

## Designed for a trusted LAN

apex-lan is built for a group of friends on the same home Wi-Fi. Its security model assumes
everyone on the network is trusted:

- **Do not expose the server to the internet** (no port forwarding, no public tunnels, no
  cloud hosting). Apart from slowing down repeated PIN guesses it has no rate limiting, it uses plain `http://` and `ws://` without
  encryption, and was never hardened for hostile traffic.
- **Each player's browser is authoritative for its own car.** The server checks that
  positions are plausible, but a player who edits the client can still drive unfairly.
- **PINs are LAN-level protection only.** A 4-digit PIN (stored with bcrypt) stops a friend
  from picking your profile by accident; it does not stop a determined attacker. Don't reuse
  a PIN that matters anywhere else.
- **The host's data stays on the host.** Profiles, results and photos live in `server/data/`
  (git-ignored). Uploaded photos are re-encoded to WebP and stripped of metadata.
- Allow the port only on your **Private** network profile (see [`HOSTING.md`](HOSTING.md)).

## Supported versions

Only the latest commit on `main` gets fixes.

## Reporting a vulnerability

Please report security problems **privately** through GitHub: on the repository page open
**Security → Report a vulnerability**. Don't open a public issue.

Useful things to include: what an attacker on the same LAN (or a malicious player) can do,
steps to reproduce, and the commit you tested. You'll get an answer as soon as the maintainer
can; this is a hobby project, so please allow a couple of weeks for a fix.

In scope: crashing or taking over the server from a browser on the LAN, reading or changing
other players' profiles or photos, path traversal in the static file server, unsafe photo
handling. Out of scope: anything that needs the server to be exposed to the internet, and
cheating by editing your own client (a known trade-off of the LAN trust model).
