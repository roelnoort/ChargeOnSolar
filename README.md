# ChargeOnSolar

Charge my EV only when there is a solar surplus

## Setup

- `scripts/setup-devices.sh` walks you through access to the charger, solar system and P1 meter.
- `scripts/setup-factory.sh` sets up the GitHub secrets and labels the [software factory](docs/agents/factory.md) needs.
- Copy `.env.example` to `.env` in the repo root and fill in the SMTP settings, so Login codes go out by email. Without them the server writes each code to its log.
- Only known Users can log in. Add and remove them from the command line: `pnpm users add <name> <email>`, `pnpm users remove <email>`, `pnpm users list`.
- Solar production comes from the Enphase cloud. After `scripts/setup-devices.sh` has saved the Enphase app's credentials and system ID, set `ENPHASE_TOKEN_KEY` in `.env` (`openssl rand -hex 32`), start the server once, then authorize ChargeOnSolar a single time: run `pnpm enphase login` and follow its steps, which end with `pnpm enphase login '<the address Enphase sent you to>'`. From then on the server renews its Enphase tokens by itself and keeps the refresh token encrypted. If it ever says Enphase is not authorized (for example after a month offline), run the login again.
