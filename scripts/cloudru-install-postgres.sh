#!/usr/bin/env bash
# Odna komanda na VM (posle sudo): bash <(curl -fsSL .../cloudru-install-postgres.sh)
# Ili: curl -fsSL ... | sudo bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "==> apt update"
apt-get update -y

echo "==> install postgresql"
apt-get install -y postgresql postgresql-contrib curl

# Tolko bukvy i cifry v parole (bez kavychek v probleme)
PW="$(openssl rand -hex 16)"

echo "==> create role and database"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS katalog;"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP ROLE IF EXISTS katalog_app;"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE katalog_app LOGIN PASSWORD '${PW}';"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE katalog OWNER katalog_app;"

echo "==> download migration"
curl -fsSL -o /tmp/001_init.sql \
  "https://raw.githubusercontent.com/kaylas000/katalog-uslug.pro/main/db/migrations/001_init.sql"

echo "==> apply migration"
sudo -u postgres psql -d katalog -v ON_ERROR_STOP=1 -f /tmp/001_init.sql

echo "==> grants"
sudo -u postgres psql -d katalog -v ON_ERROR_STOP=1 -c "GRANT CONNECT ON DATABASE katalog TO katalog_app;"
sudo -u postgres psql -d katalog -v ON_ERROR_STOP=1 -c "GRANT USAGE ON SCHEMA public TO katalog_app;"
sudo -u postgres psql -d katalog -v ON_ERROR_STOP=1 -c "GRANT SELECT ON ALL TABLES IN SCHEMA public TO katalog_app;"
sudo -u postgres psql -d katalog -v ON_ERROR_STOP=1 -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO katalog_app;"

echo ""
echo "=========================================="
echo "SOHRANI PAROL polzovatelia katalog_app:"
echo "${PW}"
echo "=========================================="
echo "Gotovo. Baza: katalog"
