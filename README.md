# ChargeOnSolar

Charge my EV only when there is a solar surplus

## Setup

- `scripts/setup-devices.sh` walks you through access to the charger, solar system and P1 meter.
- `scripts/setup-factory.sh` sets up the GitHub secrets and labels the [software factory](docs/agents/factory.md) needs.
- Copy `.env.example` to `.env` in the repo root and fill in the SMTP settings, so Login codes go out by email. Without them the server writes each code to its log.
- Only known Users can log in. Add and remove them from the command line: `pnpm users add <name> <email>`, `pnpm users remove <email>`, `pnpm users list`.
