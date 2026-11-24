# 3. Deploy from GitHub

This chapter sets up the Deploy button: a workflow in GitHub that puts a new
version of ChargeOnSolar on the NUC when you press it. One wizard on the Mac
does the work. It walks you through Tailscale's admin console, sets up GitHub,
and has you paste one key on the NUC. Then you press Deploy for the first time.

It takes about twenty minutes.

## How a deploy reaches the NUC

The NUC is never reachable from the internet. When you press Deploy, GitHub
starts a short-lived machine that joins your tailnet, SSHes to the NUC as the
user `deploy` and asks for one commit of main. Three locks keep that path
narrow:

1. The secrets it needs live only in the GitHub Environment `production`, which
   only runs from main. A workflow on any other branch never gets them.
2. Its SSH key can only run the deploy script on the NUC: no shell, no port
   forwarding.
3. In Tailscale it is tagged `tag:ci`, and the access policy lets `tag:ci`
   reach only SSH on the NUC: not the NUC's other ports, not your home
   network, not your other devices.

## What you need

- Chapter 2 done: `https://charge.<domain>` opens at home.
- `ssh nuc` logs in from the Mac without a password (chapter 1, step 7).
- The GitHub CLI on the Mac, logged in to your GitHub account. You need it to
  be an admin of the repository, which you are as its owner:

  ```sh
  brew install gh
  gh auth login
  ```

- Your Tailscale account from chapter 1.

## Step 1: Run the deploy wizard

In Terminal on the Mac, in the ChargeOnSolar folder:

```sh
git pull
scripts/setup-deploy.sh
```

These are the stages. The Tailscale ones open the page in your browser and
tell you what to click:

1. **Check GitHub and the NUC.** Checks that `gh` is logged in as an admin of
   the repository, and reads the NUC's Tailscale state over `ssh nuc`.
2. **Approve the NUC's home network route.** The NUC offers your home network
   (like `192.168.1.0/24`) to your other Tailscale devices. On the Machines
   page, click `nuc`, tick the route in its Subnets section and click
   **Save**. The wizard checks on the NUC that Tailscale approved it.
3. **Turn off key expiry for the NUC.** Otherwise Tailscale logs the NUC out
   after 180 days. On the Machines page, click the **⋯** menu in the row of
   `nuc` and choose **Disable Key Expiry**. The wizard checks this too.
4. **The GitHub Environment `production`.** Creates it, and allows only main
   to deploy to it. No questions. If the repository itself has a secret with
   one of the deploy secrets' names, the wizard tells you to delete it: GitHub
   would use it when the Environment lacks one.
5. **The tag `tag:ci` and the access policy.** Shows the policy and copies it
   to the clipboard. On the Access controls page, select everything in the
   editor, paste and click **Save**. The policy:
   - creates the tag `tag:ci`;
   - lets your own devices reach everything, as before, including your home
     network through the NUC;
   - lets `tag:ci` reach only port 22 on the NUC;
   - has tests that Tailscale runs while saving: `tag:ci` must reach SSH on
     the NUC, and must not reach the NUC's ports 80 and 443 or the NUC's home
     network address. If one fails, Tailscale refuses to save and shows why.

   It replaces Tailscale's default policy, which lets every device reach every
   other one. If you ever changed that policy yourself, look at what you'd
   lose before you save.
6. **An OAuth client for the Deploy button.** On Settings → Trust credentials,
   click **Credential**, choose **OAuth**, give **Auth Keys** (under Keys)
   **Write** access, add the tag `tag:ci` and click **Generate credential**.
   Paste the **client ID** and the **client secret** into the wizard (the
   secret stays hidden). The wizard checks them with Tailscale and saves them
   in `production` as `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET`. Tailscale
   shows the secret only once, so leave its page open until the wizard says
   it's saved.
7. **The deploy key.** Makes a new SSH key pair. The private key goes straight
   into `production` as `DEPLOY_SSH_KEY` and is then deleted from the Mac: it
   is never shown. The Mac keeps the public key, in `.env.deploy`.
8. **The NUC's address and SSH host key.** Saves the NUC's Tailscale address
   as `NUC_TAILSCALE_ADDRESS` and its SSH host key as `NUC_SSH_HOST_KEY`. The
   Deploy button talks only to a machine with that host key. The wizard reads
   the key through `ssh nuc`, which already checks that it is talking to your
   NUC. Then it checks that `production` holds all five secrets.
9. **Let the deploy key in on the NUC.** Step 2 below.

You can stop with **Ctrl-C** and start again. A second run skips what is
already done; for the OAuth client and the deploy key it asks whether to make
new ones. If you make a new deploy key, stage 9 first removes the old one from
the NUC, because part 2 only asks for a key when the NUC has none.

## Step 2: Let the deploy key in on the NUC

At stage 9, the wizard shows the deploy public key (one line starting with
`ssh-ed25519`) and copies it to the clipboard. The NUC lets it in once part 2
of the NUC wizard has it, so run part 2 again:

- Answer **y** at **Run part 2 on the NUC now, from here?** It logs in to the
  NUC, fetches the newest part 2 and starts it; type your NUC password for
  sudo.
- Or, in another terminal window: `ssh nuc`, then

  ```sh
  curl -fsSLO https://raw.githubusercontent.com/roelnoort/ChargeOnSolar/main/scripts/setup-nuc-2.sh
  sudo bash setup-nuc-2.sh
  ```

Every stage of part 2 reports that it's already done, except stage 5, "Deploys
from GitHub". There, paste the key (**Cmd-V**) and press Enter.

To check it, on the NUC:

```sh
sudo cat /home/deploy/.ssh/authorized_keys
```

It shows one line, starting with
`restrict,command="/usr/local/bin/chargeonsolar-deploy" ssh-ed25519`. Whatever
GitHub asks for, that key can only run the deploy script.

## Step 3: Press Deploy

1. Open the repository on GitHub and go to **Actions** → **Deploy** (in the
   list on the left).
2. Click **Run workflow**. Leave **Branch** on `main` and **Commit of main to
   deploy** empty, for the newest commit of main. Click the green **Run
   workflow**.
3. Click the run that appears, then the job **deploy**, to watch it.

The step **Deploy on the NUC** shows what the NUC does:

```text
Deploying <commit> (running now: <commit>).
...the build...
Deployed <commit>.
```

The first deploy builds ChargeOnSolar again, so it takes a few minutes. The
NUC then waits about a minute to check that the new version stays up. The run
turns green.

Later deploys work the same. To go back to an older version, put that commit
(from main's history) in **Commit of main to deploy**. Nothing deploys by
itself after a merge: only this button does.

## Step 4: Check it in the browser

Open `https://charge.<domain>` on a phone or laptop at home. You see
ChargeOnSolar, as at the end of chapter 2.

## When the run turns red

GitHub also emails you. Open the run and read the first red step:

- **Check the production secrets**, "lacks the secrets …": run the deploy
  wizard again.
- **Join the tailnet as tag:ci** fails: the OAuth client or the tag is wrong.
  Run the wizard again and make a new OAuth client at stage 6. Check that the
  policy of stage 5 is saved.
- **Deploy on the NUC**:
  - `Permission denied (publickey)`: the NUC doesn't have the deploy key, or
    has an older one. On the NUC, remove the old one with
    `sudo rm /home/deploy/.ssh/authorized_keys`, then do step 2 again.
  - `Host key verification failed`: the NUC's host key changed, for example
    after reinstalling Ubuntu. Run the wizard again: stage 8 saves the new
    one.
  - `Connection timed out`: the NUC is off, or isn't on Tailscale. Check
    `ssh nuc tailscale status`.
  - `Refused: … is not a commit on main.`: the commit you typed isn't on main.
  - `Deploy failed: … Rolling back to …`: the new version didn't stay up, and
    the NUC put the previous one back. `Rolled back to …` means ChargeOnSolar
    runs as before. To see why the new version stopped, on the NUC:
    `docker compose -f /srv/chargeonsolar/compose.yaml logs --tail 100`.
  - `Rollback to … failed too`: ChargeOnSolar may be down. Look at the same
    logs, and deploy a commit that worked before.

## Use ChargeOnSolar away from home

The NUC passes Tailscale traffic on to your home network, so
`https://charge.<domain>` also works from away:

1. Install the Tailscale app on your phone (App Store or Google Play).
2. Log in with the same Tailscale account.
3. Away from home, switch Tailscale on and open `https://charge.<domain>`.

`charge.<domain>` points to the NUC's home network address. With Tailscale on,
your phone sends that traffic through the NUC. At home it works with Tailscale
on or off.

If the network you're on happens to use the same addresses as your home
network (like `192.168.1.x`), that network may win and the page won't open.
Use mobile data instead.
