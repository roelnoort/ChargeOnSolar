#!/usr/bin/env bash
#
# The nightly backup of ChargeOnSolar's database on the NUC, run by cron at
# 03:00. Spec: #64, #70.
#
# It makes an online backup of the running database with `VACUUM INTO`, which
# reads one consistent snapshot while the app keeps writing (a plain file copy
# can catch the database half-written). The copy is gzipped and stored as
# chargeonsolar-YYYY-MM-DD.db.gz, with a copy of `.env` beside it as
# chargeonsolar-YYYY-MM-DD.env: the encrypted Enphase refresh token in the
# database is useless without the key in `.env`. Both are chmod 600.
#
# Retention: the 14 most recent backups are kept, plus the first backup of each
# month for the 12 months up to and including this one; older backups are
# deleted. Other files in the backup folder are left alone.
#
# Settings, overridable through the environment:
#   BACKUP_DATABASE  the live database  (/srv/chargeonsolar/data/chargeonsolar.db)
#   BACKUP_ENV_FILE  the app's .env     (/srv/chargeonsolar/.env)
#   BACKUP_DIR       where backups go   (/backup/chargeonsolar)
#   BACKUP_MOUNT     the backup disk's mount point, which must be mounted, or
#                    empty to skip that check  (/backup)
#   BACKUP_TODAY     the date to file this backup under, YYYY-MM-DD (today)
#
# Needs the sqlite3 command-line tool. Run it as the database's owner (uid 1000,
# the container's `node` user) or as root. As root, a sqlite3 that crashes
# while the app is stopped can leave root-owned -wal/-shm files the app can't
# open, so the owner is the safer choice. Any failure exits non-zero, and then
# no backups are deleted.

set -euo pipefail

database=${BACKUP_DATABASE:-/srv/chargeonsolar/data/chargeonsolar.db}
env_file=${BACKUP_ENV_FILE:-/srv/chargeonsolar/.env}
backup_dir=${BACKUP_DIR:-/backup/chargeonsolar}
backup_mount=${BACKUP_MOUNT-/backup}
today=${BACKUP_TODAY:-$(date +%F)}
keep_latest=14
keep_months=12

fail() {
  echo "Backup failed: $*" >&2
  exit 1
}

[[ "$today" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || fail "BACKUP_TODAY '$today' is not YYYY-MM-DD."
# sqlite3 would create an empty database at a missing path and back that up.
[[ -f "$database" ]] || fail "No database at $database."
[[ -f "$env_file" ]] || fail "No .env at $env_file."

# Without the HDD, /backup is an empty folder on the SSD, the disk being backed up.
if [[ -n "$backup_mount" ]]; then
  mounted_on=$(df -P "$backup_mount" 2>/dev/null | awk 'NR == 2 { print $NF }') || true
  [[ "$mounted_on" == "$backup_mount" ]] || fail "$backup_mount is not mounted, so the backup disk is missing."
fi

umask 077
mkdir -p "$backup_dir"
work=$(mktemp -d "$backup_dir/.backup-XXXXXX")
trap 'rm -rf "$work"' EXIT

sql_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"
}

sqlite3 "$database" "VACUUM INTO $(sql_quote "$work/backup.db")" ||
  fail "sqlite3 couldn't back up $database."
gzip "$work/backup.db"
cp "$env_file" "$work/backup.env"
chmod 600 "$work/backup.db.gz" "$work/backup.env"
mv "$work/backup.db.gz" "$backup_dir/chargeonsolar-$today.db.gz"
mv "$work/backup.env" "$backup_dir/chargeonsolar-$today.env"
echo "Backed up $database to $backup_dir/chargeonsolar-$today.db.gz"

# Months counted from year 0, so the 12-month window is a subtraction.
month_number() {
  echo $((10#${1:0:4} * 12 + 10#${1:5:2} - 1))
}

dates=()
for file in "$backup_dir"/chargeonsolar-????-??-??.db.gz; do
  [[ -e "$file" ]] || continue
  name=${file##*/chargeonsolar-}
  dates+=("${name%.db.gz}")
done

first_kept_month=$(($(month_number "$today") - keep_months + 1))
previous_month=
for i in "${!dates[@]}"; do
  date=${dates[$i]}
  month=${date:0:7}
  keep=false
  ((i >= ${#dates[@]} - keep_latest)) && keep=true
  if [[ "$month" != "$previous_month" ]] && (($(month_number "$date") >= first_kept_month)); then
    keep=true
  fi
  previous_month=$month
  if [[ "$keep" == false ]]; then
    rm -f "$backup_dir/chargeonsolar-$date.db.gz" "$backup_dir/chargeonsolar-$date.env"
    echo "Deleted the backup of $date"
  fi
done
