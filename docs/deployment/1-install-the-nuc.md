# 1. Install the NUC

This chapter takes the NUC from an untouched box to a secured Ubuntu server
with Docker, Tailscale and the backup disk. You need no server experience:
every step says what to press and what you should see. Do the steps in order.

It takes an afternoon. Most of it is waiting for downloads and installs.

## What you need

- The NUC with its power adapter, the 2.5" HDD fitted in its drive bay, and an
  Ethernet cable to your router.
- For the install only: a monitor (HDMI) and a USB keyboard. After this
  chapter the NUC runs without them.
- A USB stick of at least 4 GB. **Everything on it is erased.**
- Your Mac, on the same home network.
- An SSH key on your Mac that is added to your GitHub account. Check in
  Terminal on the Mac:

  ```sh
  ls ~/.ssh/id_ed25519.pub
  ```

  If the file is missing, make a key with `ssh-keygen -t ed25519` (press
  Enter to accept the file name, and choose a passphrase). Then add it to
  GitHub: open <https://github.com/settings/keys>, click **New SSH key**, and
  paste the output of `cat ~/.ssh/id_ed25519.pub`. The Ubuntu installer
  fetches your key from GitHub, so that you can log in from the Mac without a
  password.
- A Tailscale account. Create one at <https://login.tailscale.com/start>
  (logging in with GitHub is simplest). You need it in the wizard's Tailscale
  stage.
- A login for your router's admin page (often on a sticker on the router).

### What has to be done first for HTTPS and email

This chapter works without them, but the next one doesn't. ChargeOnSolar is
served at `https://charge.<domain>` and sends Login codes by email. Both
depend on [#22](https://github.com/roelnoort/ChargeOnSolar/issues/22):

- the domain registered at TransIP, with an A record `charge` pointing to
  the NUC's LAN address (you fix that address below)
- the TransIP API key for the shared proxy: `scripts/setup-transip.sh` on the
  Mac
- Lettermint for sending email: `scripts/setup-lettermint.sh` on the Mac

## Step 1: Check the hardware in the BIOS

1. Connect the monitor, the keyboard, Ethernet and power. Press the power
   button.
2. As soon as the Intel logo shows, press **F2** a few times. The BIOS setup
   opens (Intel calls it Visual BIOS).
3. On the first screen, check:
   - **Memory**: about 8 GB (8192 MB).
   - **Storage**: two drives: the SSD (about 128 GB) and the HDD. If you don't
     see the drives here, look under **Advanced → Devices** (the exact place
     differs a little between BIOS versions).
4. Write down the **BIOS version** shown at the top, for example
   `SYSKLi35.86A.0073`. You need it in the next step.

If the HDD is missing, the NUC can't see it. Switch off, unplug the power,
and reseat the drive in its bay before going on.

## Step 2: Update to Intel's last BIOS for the NUC6

The last BIOS fixes security problems in the processor. The NUC6 is no
longer sold, but Intel still keeps the final BIOS for download.

1. Find the exact model on the sticker under the NUC, for example
   `NUC6i5SYH`.
2. On the Mac, open <https://www.intel.com/content/www/us/en/download-center/home.html>
   and search for that model plus "BIOS".
3. Open the newest BIOS update in the list. If its version number is the
   same as the one you wrote down, your BIOS is already up to date: skip to
   step 3.
4. Download the file that ends in **`.bio`** (the "F7" update). The page also
   offers other formats; you don't need those.
5. Copy the `.bio` file to the USB stick. It must be formatted as FAT32 (the
   Mac's Disk Utility calls it "MS-DOS (FAT)"). This erases the stick, which
   is fine: you make the Ubuntu stick from it afterwards.
6. Put the stick in the NUC, switch it on, and press **F7** when the Intel
   logo shows. Choose the `.bio` file on the stick and confirm.
7. Wait. The NUC may restart more than once. **Do not switch it off or pull
   the power while it updates.** It is done when it boots normally again (to
   "no bootable device", which is fine now).

If Intel no longer offers the download, skip this step: the NUC works with
the BIOS it has.

## Step 3: Make the NUC switch on by itself after a power cut

ChargeOnSolar must record day and night, also after a power failure.

1. Restart the NUC and press **F2** again.
2. Go to **Advanced → Power → Secondary Power Settings**.
3. Set **After Power Failure** to **Power On**.
4. Press **F10** to save and exit.

## Step 4: Make the Ubuntu Server USB stick

1. On the Mac, download **Ubuntu Server 26.04 LTS** from
   <https://ubuntu.com/download/server> (option 2, manual install). You get
   a file like `ubuntu-26.04-live-server-amd64.iso`.
2. Check the download isn't damaged. In Terminal, in the folder with the file:

   ```sh
   shasum -a 256 ubuntu-26.04-*-live-server-amd64.iso
   ```

   Compare the long number with the one on the download page (the "verify
   your download" link), or in the `SHA256SUMS` file next to the ISO on
   <https://releases.ubuntu.com/26.04/>. They must be the same.
3. Install **balenaEtcher** from <https://etcher.balena.io>. Open it, choose
   **Flash from file** and pick the ISO, choose the USB stick as the target,
   and click **Flash**. Your Mac asks for its password.
4. When Etcher is done, the Mac may say it can't read the disk. Click
   **Eject**. That's expected: the stick is now in a format only the NUC
   reads.

## Step 5: Install Ubuntu Server

1. Put the stick in the NUC and switch it on. Press **F10** when the Intel
   logo shows and choose the USB stick (it may be listed as "UEFI: ...").
2. Choose **Try or Install Ubuntu Server**.

The installer asks a series of questions. Use the **arrow keys** and **Tab** to
move, **Space** to tick a box, and **Enter** to choose. Choose these:

- **Language**: English
- **Installer update available**: Continue without updating
- **Keyboard**: Your keyboard layout
- **Choose the type of installation**: **Ubuntu Server (minimized)**. Tick it with Space.
- **Network configuration**: Leave it: the Ethernet port gets an address by DHCP. **Write down that address** (like `192.168.1.23/24`): you need it in step 6.
- **Proxy configuration**: Leave empty
- **Ubuntu archive mirror**: Leave as it is
- **Guided storage configuration**: **Use an entire disk**, and pick the **SSD (about 128 GB)**. Do **not** pick the HDD: the wizard sets that one up later. **Untick "Set up this disk as an LVM group"**, so Ubuntu gets the whole SSD without extra steps. Don't tick encryption.
- **Storage configuration**: Check that only the SSD is used, then **Done** and **Continue** to confirm.
- **Profile setup**: Your name; the server's name: `nuc`; a username (for example your first name in lowercase); and a password. **Remember the password**: you need it for `sudo`.
- **Upgrade to Ubuntu Pro**: Skip for now
- **SSH configuration**: **Tick "Install OpenSSH server"**. At **Import SSH key**, choose **from GitHub** and type your GitHub username. It shows your key(s): confirm. Leave the password authentication setting as it is: the wizard switches password logins off once your key works.
- **Featured server snaps**: **Tick nothing.** In particular, **not `docker`**: the wizard installs Docker from Docker's own repository, and the snap version breaks shared folders.

Then the installer runs. When it shows **Reboot Now**, choose it, pull out the
USB stick when it asks, and press Enter.

The NUC boots into a text login prompt. You log in here once more, in the
next step. After that you use SSH from the Mac.

## Step 6: Give the NUC a fixed address in your router

Your router hands out addresses by DHCP, and they may change. A **DHCP
reservation** tells the router to always give the NUC the same address, so
`charge.<domain>` keeps pointing to it.

1. Find the NUC's network card ID (its MAC address). Log in on the NUC's
   own screen with your username and password, and type:

   ```sh
   ip -br link
   ```

   The line starting with `en` (like `eno1`) shows the MAC address, six
   pairs like `94:c6:91:a1:b2:c3`.
2. Open your router's admin page in a browser on the Mac. Its address is
   your Mac's "Router" address: **System Settings → Network → Ethernet or
   Wi-Fi → Details → TCP/IP**. Often it is `192.168.1.1`.
3. Look for a setting called **DHCP reservation**, **static lease**,
   **address reservation** or **fixed IP** (Dutch routers: "vast IP-adres"
   or "statische DHCP"). It is often under LAN, Network or DHCP settings.
4. Add a reservation for the NUC's MAC address with the address it has now
   (from step 5). Save.
5. Restart the NUC (`sudo reboot`, or the power button) and check with
   `ip -br addr` that it got that address again.

Now set the A record `charge` at TransIP (see #22) to this address, if you
haven't yet.

## Step 7: Log in from the Mac

From here on, the monitor and keyboard aren't needed.

1. In Terminal on the Mac (replace the username and address with yours):

   ```sh
   ssh roel@192.168.1.23
   ```

2. The first time, SSH asks whether you trust the NUC's host key
   ("Are you sure you want to continue connecting?"). Type `yes`. On your own
   home network that is safe.
3. You are logged in without a password: that's your key from GitHub at
   work. If it asks for a password instead, the key import didn't work. Type
   your NUC password, and the wizard will help you add the key.

To save typing, add this to `~/.ssh/config` on the Mac (create the file if it
doesn't exist):

```
Host nuc
  HostName 192.168.1.23
  User roel
```

From then on, `ssh nuc` is enough.

## Step 8: Run the NUC wizard

The wizard does the rest of the setup on the NUC, stage by stage. It shows
what each stage is about to do and asks before anything risky.

1. Copy the wizard from the repo on your Mac to the NUC. In Terminal on the
   Mac, in the ChargeOnSolar folder:

   ```sh
   scp scripts/setup-nuc.sh nuc:
   ```

   Or fetch it on the NUC itself:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/roelnoort/ChargeOnSolar/main/scripts/setup-nuc.sh
   ```

2. On the NUC (`ssh nuc`), start it:

   ```sh
   sudo bash setup-nuc.sh
   ```

   `sudo` asks for your NUC password.

These are the stages, and what you do in each:

1. **SSH: key login only.** Switches off password logins and logins as root.
   First it checks that your key works, so you can't lock yourself out. If
   it can't confirm that, it tells you to log in from a second Mac terminal
   with `ssh -o PasswordAuthentication=no ...`. Afterwards, **keep the
   wizard's window open** and check in a new Mac terminal that `ssh nuc`
   still works.
2. **Docker Engine and Compose**, from Docker's own repository. Container
   logs rotate (3 files of 10 MB each), so they can't fill the SSD.
3. **Docker without sudo.** Adds you to the `docker` group. It takes effect
   after you log out and back in.
4. **Automatic security updates.** Only security updates, installed every
   day. When one needs a restart, the NUC restarts at 04:00 that night;
   otherwise it never restarts by itself.
5. **Firewall.** It shows the home network it found (like
   `192.168.1.0/24`): confirm it. Then only SSH, HTTP and HTTPS get in, and
   only from your home network and from Tailscale.
6. **Tailscale.** Prints a link. Open it on the Mac and log in with your
   Tailscale account. The NUC then joins your tailnet and offers your home
   network to it ("subnet router").
7. **Backup disk at `/backup`.** Finds the HDD and shows it.
   - **If it's empty**, type its name (like `sda`) to format it.
   - **If it has an ext4 filesystem** (from an earlier install, say), it
     shows the files and offers to keep them.
   - **Anything else** gets a clear warning: it formats the disk only if you
     type `erase <name>`.

   Then it mounts the disk at `/backup`, also after every restart.
8. **Folders under `/srv`.** `/srv/proxy` for the shared HTTPS proxy, and
   `/srv/chargeonsolar` for the app.

At the end it shows what it did, what was already done, and what's next.

You can stop the wizard at any time with **Ctrl-C** and start it again later.
Every stage checks first whether it is already done and then skips it. A
second run that finds everything in place changes nothing.

### Afterwards

- Log out (`exit`) and back in (`ssh nuc`), so `docker` works without sudo.
- In the Tailscale admin console, approve the NUC's subnet route and turn off
  its key expiry. The deploy wizard in
  [chapter 3](./3-deploy-from-github.md) walks you through it.
- Continue with [chapter 2](./2-put-chargeonsolar-on-the-nuc.md): part 2 of
  the NUC wizard puts ChargeOnSolar, the proxy, deploys and backups on the NUC.
