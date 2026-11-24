# 2. Put ChargeOnSolar on the NUC

This chapter takes the NUC from the base system of chapter 1 to ChargeOnSolar
running at `https://charge.<domain>`, with deploys and nightly backups in
place. One wizard, part 2 of the NUC wizard, does the work. You copy three
files from the Mac first and answer a few questions.

It takes about half an hour, most of it waiting for builds.

## What you need

- Chapter 1 done, and logged out and back in once (`exit`, then `ssh nuc`).
- [#22](https://github.com/roelnoort/ChargeOnSolar/issues/22) done:
  - the domain at TransIP, with the A record `charge` pointing to the NUC's
    LAN address
  - the TransIP API key: `scripts/setup-transip.sh` saved it on the Mac in
    `deploy/proxy/.env` and `deploy/proxy/transip.key`
  - Lettermint: `scripts/setup-lettermint.sh` put the SMTP settings in the
    Mac's `.env`
- The Mac's `.env` filled in by `scripts/setup-devices.sh` (Zaptec, Enphase
  and the HomeWizard P1 meter).

## Step 1: Copy the settings from the Mac

ChargeOnSolar's `.env` and the proxy's TransIP key are secrets, so they don't
go through GitHub. You copy them to a folder `from-mac` in your home folder on
the NUC. The wizard moves them into place, readable only by the user that
needs them, and deletes the copies.

In Terminal on the Mac, in the ChargeOnSolar folder:

```sh
ssh nuc 'mkdir -p -m 700 from-mac'
scp .env nuc:from-mac/chargeonsolar.env
scp deploy/proxy/.env nuc:from-mac/proxy.env
scp deploy/proxy/transip.key nuc:from-mac/transip.key
```

If you can't copy them, skip this step: the wizard then asks for each value
and you type them in, the secret ones hidden.

## Step 2: Run part 2 of the NUC wizard

1. Copy the wizard to the NUC, the same way as part 1. On the Mac, in the
   ChargeOnSolar folder:

   ```sh
   scp scripts/setup-nuc-2.sh nuc:
   ```

   Or fetch it on the NUC itself:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/roelnoort/ChargeOnSolar/main/scripts/setup-nuc-2.sh
   ```

2. On the NUC (`ssh nuc`), start it:

   ```sh
   sudo bash setup-nuc-2.sh
   ```

These are the stages, and what they ask:

1. **The deploy user.** Creates the user `deploy`, which GitHub's Deploy
   button logs in as. It has no password, is in the `docker` group so it can
   build and start ChargeOnSolar, and owns `/srv/chargeonsolar`. No questions.
2. **ChargeOnSolar's code.** Clones the repo from GitHub into
   `/srv/chargeonsolar`. The repo is public, so it needs no GitHub login. No
   questions.
3. **ChargeOnSolar's settings (`.env`).** Moves `from-mac/chargeonsolar.env`
   to `/srv/chargeonsolar/.env`, readable only by `deploy` (`chmod 600`). If
   it isn't there, it shows the `scp` command and asks **Copied it?**:
   - **y** after you have copied it in another Mac terminal.
   - **n** to type the settings in instead. They are the ones in the Mac's
     `.env`. Press Enter to leave one out, for example a device you don't
     have.

   It also makes `ENPHASE_TOKEN_KEY` if the `.env` has none. The wizard never
   shows the file.
4. **The shared HTTPS proxy.** Copies the proxy's files from the repo into
   `/srv/proxy`. Then it moves `proxy.env` and `transip.key` from `from-mac`
   next to them, both `chmod 600`. If they aren't there, it asks for:
   - **Domain registered at TransIP**, like `example.com`
   - **Email for Let's Encrypt's certificate warnings**
   - **TransIP account name**, the username you log in to TransIP with (not
     your email address)
   - **The TransIP private key**. Paste it, including the `BEGIN` and `END`
     lines. Your typing stays hidden.

   Then it builds the proxy and starts it, which takes a few minutes the
   first time. You can edit `/srv/proxy/Caddyfile` later, to add another
   project: a re-run of the wizard never overwrites it.
5. **Deploys from GitHub.** Installs the deploy script as
   `/usr/local/bin/chargeonsolar-deploy`, outside the git checkout, so a
   deploy can't change the script it is running. Then it asks for the
   **deploy public key**. That key doesn't exist yet: the deploy wizard on
   the Mac makes it in [chapter 3](./3-deploy-from-github.md). **Press Enter
   to skip it for now**, and run this wizard again once you have it. The key
   it saves can only run the deploy script: it gets no shell and can't
   forward ports.
6. **Nightly backup.** Installs the backup script as
   `/usr/local/bin/chargeonsolar-backup`, and a cron job that runs it every
   night at 03:00. It backs up the database and `.env` to
   `/backup/chargeonsolar`, keeping the last 14 nights and the first backup
   of each month for a year. No questions. It warns you if the backup disk
   isn't mounted at `/backup`.
7. **Start ChargeOnSolar.** Builds the app and starts it, which takes several
   minutes the first time. Then it waits for `https://charge.<domain>` to
   answer with a valid certificate. The proxy gets that certificate from
   Let's Encrypt through TransIP, which can take a few minutes the first time.
   Last, it checks that `charge.<domain>` points to the NUC.

At the end it shows what it did, what was already done, and what's left.

You can stop with **Ctrl-C** and start again. A second run that finds
everything in place changes nothing, with one exception: when main has a newer
deploy or backup script, it installs that one.

### When the certificate doesn't come

If stage 7 gives up waiting, look at what the proxy says:

```sh
docker compose -f /srv/proxy/compose.yaml logs caddy
```

Errors that mention TransIP usually mean the account name or the key is
wrong, or the key pair is set to accept only whitelisted IP addresses (see
#22). Fix it, then put the right values in `/srv/proxy/.env` or
`/srv/proxy/transip.key` and run the wizard again.

## Step 3: Check it in a browser

On a phone or laptop on your home network, open `https://charge.<domain>`.
You should see ChargeOnSolar's login page, with a padlock in the address bar.

If the browser can't find the site, but the wizard said the address answers:

- Check the A record `charge` at TransIP: it must be the NUC's LAN address.
- Some routers refuse DNS answers that point to an address on your own
  network ("DNS rebind protection"). In the router's settings, allow your
  domain as an exception.

Continue with [chapter 3](./3-deploy-from-github.md): the deploy wizard on the
Mac sets up the Deploy button.

## Later: add the deploy key

The deploy wizard in [chapter 3](./3-deploy-from-github.md) makes the deploy
key, and then has you run `sudo bash setup-nuc-2.sh` again and paste the
public key at stage 5. Every other stage reports that it's already done.

To replace the key later, delete the old one first, then run the wizard again:

```sh
sudo rm /home/deploy/.ssh/authorized_keys
```

## Restore a backup

Restore a backup when the database is damaged, or after you replace the SSD.
Everything ChargeOnSolar recorded after that backup is lost.

The backups are on the backup disk, one pair per night:

- `chargeonsolar-<date>.db.gz` is the database, compressed.
- `chargeonsolar-<date>.env` is the `.env` of that night. You need it when the
  `.env` on the NUC is gone, because the Enphase refresh token in the
  database only works with its `ENPHASE_TOKEN_KEY`.

To see whether last night's backup worked: `journalctl -t chargeonsolar-backup`.

1. Log in (`ssh nuc`) and list the backups. Choose a date:

   ```sh
   sudo ls -l /backup/chargeonsolar
   ```

2. Stop ChargeOnSolar:

   ```sh
   cd /srv/chargeonsolar
   sudo docker compose stop
   ```

3. Move the current database aside, with its `-wal` and `-shm` files. Those
   two belong to the current database and would damage the restored one if
   they stayed next to it:

   ```sh
   sudo mkdir data/before-restore
   sudo mv data/chargeonsolar.db* data/before-restore/
   ```

4. Decompress the backup into the data folder, and give it to the app's user
   (uid 1000). Put your chosen date in the first line:

   ```sh
   date=2026-11-23
   sudo sh -c "gunzip -c /backup/chargeonsolar/chargeonsolar-$date.db.gz > data/chargeonsolar.db"
   sudo chown 1000:1000 data/chargeonsolar.db
   ```

5. Only if the `.env` is gone or was changed since the backup, restore that
   too:

   ```sh
   sudo install -m 600 -o deploy -g deploy /backup/chargeonsolar/chargeonsolar-$date.env .env
   ```

6. Start ChargeOnSolar, and check it in the browser:

   ```sh
   sudo docker compose start
   ```

7. Once everything looks right, delete the old database:

   ```sh
   sudo rm -r data/before-restore
   ```

### After replacing the SSD

The backups are on the HDD, so they survive a dead SSD.

1. Do chapter 1 again. At the backup disk stage, the wizard shows the files
   already on the HDD: keep them.
2. Before running part 2, give it the `.env` from the backup instead of the
   Mac's:

   ```sh
   mkdir -p -m 700 ~/from-mac
   sudo install -m 600 -o "$USER" /backup/chargeonsolar/chargeonsolar-<date>.env ~/from-mac/chargeonsolar.env
   ```

   Copy the proxy's two files from the Mac as in step 1.
3. Run part 2 (step 2 of this chapter). It starts ChargeOnSolar with an
   empty database.
4. Restore the database: steps 2, 3, 4 and 6 of the restore above.
