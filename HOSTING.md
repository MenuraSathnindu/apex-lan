# Hosting a LAN race

Your laptop runs the game server. Friends on the **same Wi-Fi** open a link in their browser.
They don't install anything.

## TL;DR

```powershell
npm install        # first time only
npm run host       # builds the game, then serves it + the multiplayer socket on port 3000
```

It prints something like:

```
apex-lan server listening on :3000
  Local:   http://localhost:3000
  Join at: http://192.168.1.10:3000     (Wi-Fi)
  Other:   http://172.31.64.1:3000      (vEthernet (Default Switch), probably VPN/VM)

  Scan to open http://192.168.1.10:3000 (Wi-Fi):
  ▄▄▄▄▄▄▄ (QR code)
```

- Send friends the **`Join at:`** link marked `(Wi-Fi)`, or let them scan the QR code with a phone camera.
  Ignore the `Other:` lines. Those belong to VPN and virtual-machine adapters that friends can't reach.
- You play from the same laptop at `http://localhost:3000`. On `localhost` a gamepad works too.
- Press **Ctrl+C** to stop the server.
- The first person to join is the host and gets the **Start** button.

| Need | How |
|---|---|
| Different port | PowerShell: `$env:PORT=4000; npm run host`. Git Bash: `PORT=4000 npm run host`. Then allow that port in the firewall (below). |
| No QR code | `$env:APEX_QR=0` (or `APEX_QR=0` in bash). `NO_COLOR=1` prints it without colours, for dark terminals only. |
| Skip the rebuild | `npm start` serves the last build. Run `npm run host` again after pulling changes. |
| Dev mode | `npm run dev` hot-reloads, and friends join on port **5173** instead of 3000. Allow both ports. |

> The QR code opens the game on a phone, but there are no touch controls yet. Friends need a laptop
> with a keyboard. On a phone the code is still a quick way to check that the network is reachable.

---

## 1. Allow the port through Windows Firewall

Windows blocks incoming connections by default. This is the #1 reason friends can't connect, because
the game works fine on your own laptop while the firewall blocks everyone else.

### Option A: one command (recommended)

Open **PowerShell or Terminal as Administrator**: Start menu → type `terminal` → right-click →
*Run as administrator*. Then run:

```powershell
netsh advfirewall firewall add rule name="apex-lan" dir=in action=allow protocol=TCP localport=3000 profile=private
```

It should answer `Ok.`. The same port carries both the web page and the WebSocket, so this one rule
is all `npm run host` needs.

- **Dev mode** also needs port 5173:
  ```powershell
  netsh advfirewall firewall add rule name="apex-lan dev" dir=in action=allow protocol=TCP localport=5173 profile=private
  ```
- If your Wi-Fi is marked **Public**, either switch it to Private (see section 2, better), or use
  `profile=private,public`. Public lets anyone on a café or campus network reach port 3000 while
  the rule exists, so remove it afterwards.
- To check the rule: `netsh advfirewall firewall show rule name="apex-lan"`
- To remove it: `netsh advfirewall firewall delete rule name="apex-lan"`

The same rule written as a PowerShell cmdlet does the same thing:

```powershell
New-NetFirewallRule -DisplayName "apex-lan" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private
```

A port rule keeps working when you update Node. A rule tied to `node.exe` breaks when the path
changes, for example with nvm, where each Node version lives in its own folder.

### Option B: the pop-up

The first time Node listens on the network, Windows may show *"Windows Defender Firewall has blocked
some features of Node.js"*. Tick **Private networks** and click **Allow access**.

If you clicked **Cancel**, Windows created a **Block** rule for Node. **Block rules beat allow rules**,
so delete it before anything else will work:

```powershell
# Show block rules for Node (normal PowerShell is fine)
Get-NetFirewallApplicationFilter | Where-Object Program -like '*node*' | Get-NetFirewallRule | Where-Object Action -eq Block |
  Select-Object DisplayName, Profile, Enabled
# Delete them (Administrator)
Get-NetFirewallApplicationFilter | Where-Object Program -like '*node*' | Get-NetFirewallRule | Where-Object Action -eq Block | Remove-NetFirewallRule
```

### Option C: by clicking

1. Start → **Windows Defender Firewall with Advanced Security** (or run `wf.msc`).
2. **Inbound Rules** → **New Rule…** → **Port** → Next.
3. **TCP**, *Specific local ports*: `3000` → Next.
4. **Allow the connection** → Next.
5. Tick **Private** only → Next. Name it `apex-lan` → Finish.

---

## 2. Set your Wi-Fi to Private

Windows treats **Public** networks as hostile and applies stricter firewall rules there. At home or
at a friend's place, mark the network **Private**:

- **Settings** → **Network & internet** → **Wi-Fi** → *(your network)* properties →
  **Network profile type** → **Private network**.
- Or in PowerShell as Administrator:
  ```powershell
  Get-NetConnectionProfile                                         # shows Public/Private per adapter
  Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
  ```

On a network you don't trust (café, hotel, campus), leave it Public. Use a phone hotspot instead
(see troubleshooting).

---

## 3. Find your IP address

The server prints it on startup. That's the `Join at:` line, and the QR code encodes it. To look it
up yourself:

- **Command:** run `ipconfig` and look under **Wireless LAN adapter Wi-Fi** for **IPv4 Address**,
  e.g. `192.168.1.10`. Ignore `vEthernet`, `WSL`, `VirtualBox`, `CloudflareWARP` and other virtual
  adapters.
- **Settings:** **Network & internet** → **Wi-Fi** → *(your network)* properties → **IPv4 address**.

The link is `http://<that IP>:3000`.

Home routers hand out addresses dynamically, so your IP can change between sessions. Re-check the
startup line each time. To keep it fixed, set a DHCP reservation for your laptop in the router's
admin page.

---

## 4. Troubleshooting: "my friends can't connect"

Work through these in order. Each step rules out one layer.

1. **Does it work on your laptop with the LAN address?** Open `http://192.168.x.x:3000` (your IP,
   not `localhost`) on the host laptop.
   - If not, the server isn't running, it's on a different port, or the IP is wrong. Check the
     terminal for errors.
   - `Port 3000 is already in use` means another copy is still running. Close it, or find it with
     `netstat -ano | findstr :3000` and end that PID in Task Manager. You can also use another port
     (see the table above).
   - `Client not built` means you ran `npm start` before any build. Use `npm run host`.
   - Note that your own laptop isn't affected by its firewall, so this test passing doesn't prove
     friends can get in.

2. **Is your friend on the same network?**
   - Same Wi-Fi name, and **not** the router's *guest* network. Guest networks are isolated on
     purpose.
   - On a phone, turn off mobile data while testing. Otherwise it may load nothing or try the
     link over 4G.

3. **Did they type the link exactly?** It must be `http://` (not `https://`) and include `:3000`.
   - Some browsers silently upgrade to https: Firefox *HTTPS-Only Mode*, and Edge or Chrome
     settings that force https. Click "Continue to HTTP site" or add an exception.

4. **Test the port from your friend's computer:**
   - Windows (PowerShell): `Test-NetConnection 192.168.x.x -Port 3000` should show
     `TcpTestSucceeded : True`.
   - macOS/Linux: `nc -vz 192.168.x.x 3000` or `curl -I http://192.168.x.x:3000`
   - Don't trust `ping`. Windows Firewall blocks ping by default even when the game port is open.

5. **If the port test fails, it's the host's firewall** (sections 1 and 2):
   - Is the Wi-Fi profile Public while your rule only covers Private?
   - Is there a Block rule for Node?
   - To diagnose, briefly turn the firewall off for the current profile (Windows Security →
     Firewall & network protection → *your active network* → off). Try again, then **turn it back
     on**. If it works with the firewall off, it's a firewall rule problem.
   - **Third-party antivirus** (Norton, McAfee, Kaspersky, Avast, ESET, Bitdefender) runs its own
     firewall that ignores Windows' rules. Allow Node or port 3000 there too.

6. **A VPN on the host** (Cloudflare WARP, NordVPN, a work VPN) can capture or block local traffic.
   Disconnect it while hosting, or enable its "allow LAN / local network" option.

7. **The network blocks device-to-device traffic** ("AP isolation" or "client isolation"). Hotels,
   campuses, offices and some mesh or ISP routers do this. If everything above checks out and the
   port test still fails, this is the likely cause. Workarounds:
   - **Phone hotspot:** turn on a hotspot on any phone, and connect the host laptop and every
     friend to it. Restart `npm run host` and share the new IP it prints.
   - **Windows Mobile hotspot:** Settings → Network & internet → **Mobile hotspot** → on. Friends
     join the laptop's hotspot. Your IP on it is usually `192.168.137.1`, so the link becomes
     `http://192.168.137.1:3000`. That adapter may print as "Local Area Connection* N" under
     `Join at:`. The QR code still shows the Wi-Fi address, so share this link by hand.
   - At home, look for "AP isolation" in the router's admin page and turn it off.

8. **The page loads but says disconnected, or never reaches the lobby.**
   - The game and its WebSocket share port 3000, so if the page loads the port is open.
   - Ask the friend to reload. Check the host terminal for `[ws] connection from …` lines.
   - The room holds **8 players**. A player who just left keeps their slot for 30 s so they can
     rejoin.

### Not problems

- **The first load is slow** (several seconds). The game is a few MB, plus the car model and sky
  if you downloaded them. Browsers cache it, so the next load is quick.
- **Red `404` errors for `sounds/*.ogg` in the browser console** are normal. Those are optional
  sound overrides. Without them the game uses its built-in sounds (see `docs/ASSETS.md`).
- **A friend's laptop is choppy.** Menu (Esc) → Graphics → **Low**.
- **A gamepad works for the host but not for friends.** Browsers only allow gamepads on `localhost`
  or https. Friends on the `http://192.168…` link use the keyboard.

---

## Quick checklist for game night

- [ ] Laptop plugged in, on the same Wi-Fi as everyone (not a guest network), VPN off
- [ ] Wi-Fi set to **Private**, firewall rule for TCP **3000** added (one-time)
- [ ] `npm run host`, then share the `Join at:` link or the QR code
- [ ] Friend can't connect? `Test-NetConnection <ip> -Port 3000` from their machine, then section 4
