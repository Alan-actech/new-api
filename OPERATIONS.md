# Galapi Operations Runbook

Deployment + operations guide for the Galapi AI gateway demo at `ai-demo.bio-matrix.io`.

> **Credentials:** All passwords, API keys, and secrets referenced as `$VAR_NAME` or "see credentials.local.txt" are stored in a gitignored file (`credentials.local.txt`) at the project root. Ask a teammate for the file. Before running commands with `$VAR_NAME`, export the vars or fill them inline.

---

## 1. Stack Overview

```
User Browser
    ↓ HTTPS
Caddy (EC2, Let's Encrypt) → 127.0.0.1:3000 (new-api)
                              127.0.0.1:8080 (sub2api admin, internal)

new-api        ─ Go + React, forked from QuantumNous/new-api
sub2api        ─ Go + Vue, Wei-Shaw/sub2api
redis          ─ local cache, session storage
PostgreSQL     ─ REMOTE at zeus.bio-matrix.io
                 schemas: galapi_newapi (for new-api)
                         galapi_sub2api (for sub2api)
```

Source of truth:
- Code: `https://github.com/Alan-actech/new-api` branch `upgrade/v1.0.0-rc.11` (was `feature/homepage-cleanup` before the 2026-06-16 upgrade to upstream v1.0.0-rc.11)
- Frontend now ships TWO themes (`web/default` React19 / `web/classic` React18-Semi). We serve **classic** (option `theme.frontend` unset → code default `classic`); our Galapi homepage/topup/OIDC customizations live in `web/classic/src/`.
- Deployment: EC2 `i-0b0f6cf74bc78b251` (us-east-1)
- DNS: Route53 hosted zone `bio-matrix.io`, A record `ai-demo.bio-matrix.io`

---

## 2. Access

### SSH to EC2

EC2 uses Instance Connect (temp SSH key pushes); no persistent key saved.

```bash
# 1. Push your public key (valid ~60s)
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-0b0f6cf74bc78b251 \
  --instance-os-user ec2-user \
  --ssh-public-key "$(cat ~/.ssh/ai-demo.pub)"

# 2. SSH with the corresponding private key
CURRENT_IP=$(aws ec2 describe-instances --instance-ids i-0b0f6cf74bc78b251 \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text)
ssh -i ~/.ssh/ai-demo ec2-user@$CURRENT_IP
```

If you don't have `~/.ssh/ai-demo`:
```bash
ssh-keygen -t ed25519 -f ~/.ssh/ai-demo -N ""
# Then re-push and SSH as above
```

### Admin panels

- **new-api:** https://ai-demo.bio-matrix.io  — admin login see `credentials.local.txt`
- **sub2api:** http://ai-demo.bio-matrix.io:8080  — admin login `admin@demo.local` (password in `credentials.local.txt`)

To retrieve sub2api admin password (set once on first boot):
```bash
ssh -i ~/.ssh/ai-demo ec2-user@<ip> \
  'docker logs ai-sub2api 2>&1 | grep "Generated admin password"'
```

### Database

```bash
docker run --rm -it postgres:16-alpine psql \
  "postgresql://zeus_admin:$ZEUS_PASSWORD_URL_ENCODED@zeus.bio-matrix.io:5432/zeus?options=-csearch_path%3Dgalapi_newapi&sslmode=require"
```

Schemas: `galapi_newapi` and `galapi_sub2api`. `!` in password URL-encoded as `%21`.

---

## 3. Deploy a Code Change

```bash
# 1. Local: commit + push
cd C:\ai\token_router\new-api
git checkout feature/homepage-cleanup
# ... make changes ...
git add .
git commit -m "feat: ..."
git push origin feature/homepage-cleanup

# 2. SSH to EC2
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-0b0f6cf74bc78b251 \
  --instance-os-user ec2-user \
  --ssh-public-key "$(cat ~/.ssh/ai-demo.pub)"
ssh -i ~/.ssh/ai-demo ec2-user@<ip>

# 3. On EC2: pull + build + deploy
cd ~/new-api-src
git pull origin feature/homepage-cleanup
nohup docker build -t new-api:custom . > ~/build.log 2>&1 &
disown

# 4. Wait ~3-5 min, verify image
docker images new-api:custom

# 5. Recreate container
cd ~/ai-platform
docker compose up -d --force-recreate new-api

# 6. IMPORTANT: clean cache to prevent disk fill
docker builder prune -af
```

### Method B — ship a locally-built image (for major / risky upgrades)

Used for the **2026-06-16 v1.0.0-rc.11 upgrade**. For big version jumps (v1.0.0+ builds TWO frontends → OOM/disk risk on the live t3.large, and produces an unvalidated binary), build + validate locally, then ship the exact image:

```bash
# LOCAL: build, then (strongly recommended) dry-run migrations on a SCHEMA COPY first
docker build -t new-api:rc11-test .
docker save new-api:rc11-test | gzip > /tmp/img.tar.gz          # ~60MB

# ship via scp (more robust than streaming `docker save | ssh | docker load`, which can reset mid-stream)
aws ec2-instance-connect send-ssh-public-key --instance-id i-0b0f6cf74bc78b251 \
  --instance-os-user ec2-user --ssh-public-key "$(cat ~/.ssh/ai-demo.pub)"
scp -i ~/.ssh/ai-demo /tmp/img.tar.gz ec2-user@<ip>:~/img.tar.gz

# ON EC2: tag current as rollback, load new, retag to custom, recreate
docker tag new-api:custom new-api:rollback-$(date +%Y%m%d)
docker load -i ~/img.tar.gz && docker tag new-api:rc11-test new-api:custom && rm ~/img.tar.gz
cd ~/ai-platform && docker compose up -d --force-recreate new-api
```

**ALWAYS back up the DB first** (`pg_dump -n galapi_newapi | gzip`) — GORM AutoMigrate runs on boot against the shared prod schema. Migration dry-run: `pg_dump --schema-only -n galapi_newapi` → load into a throwaway `postgres:15` → boot the new image against it → confirm 0 errors. Note: the EC2 deploy `ssh` may be flagged by the local Claude Code safety classifier (the internal-email `$500` grant reads like a "backdoor") — approve it; it's our intended feature.

---

## 4. Common Operations

### Restart stack without rebuild
```bash
cd ~/ai-platform && docker compose restart new-api sub2api
```

### Check status
```bash
docker compose ps
docker logs ai-new-api --tail 30
docker logs ai-sub2api --tail 30
free -m
df -h /
sudo systemctl status caddy
```

### Rollback to the previous custom image (after a bad deploy)

```bash
cd ~/ai-platform
docker tag new-api:rollback-20260616 new-api:custom   # most-recent known-good image
docker compose up -d --force-recreate new-api
```
Only restore a DB dump (`C:\ai\token_router\backups\galapi_newapi_pre_*.sql.gz`) if a migration corrupted data — rare, since migrations are additive.

### Rollback to stock nightly
```bash
cd ~/ai-platform
sed -i 's|new-api:custom|calciumion/new-api:nightly|' docker-compose.yml
docker compose pull new-api && docker compose up -d new-api
```

### Site unreachable / 5xx

Likely OOM or disk full. Quick recovery:
```bash
# If SSH responds, check resources first:
free -m        # is swap exhausted?
df -h /        # is disk full?
docker ps      # are containers up?

# If SSH doesn't respond, reboot EC2:
aws ec2 reboot-instances --instance-ids i-0b0f6cf74bc78b251
# Wait ~2 min, then SSH in and clean up
```

### EC2 IP changed (after stop/start)

```bash
NEW_IP=$(aws ec2 describe-instances --instance-ids i-0b0f6cf74bc78b251 \
  --query "Reservations[0].Instances[0].PublicIpAddress" --output text)
echo "New IP: $NEW_IP"

aws route53 change-resource-record-sets --hosted-zone-id Z02893803142IW0E545HE \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"UPSERT\",
      \"ResourceRecordSet\": {
        \"Name\": \"ai-demo.bio-matrix.io\",
        \"Type\": \"A\",
        \"TTL\": 60,
        \"ResourceRecords\": [{\"Value\": \"$NEW_IP\"}]
      }
    }]
  }"
```

---

## 5. Pricing & Subscription Configuration

All pricing config is captured in `deploy/setup-pricing.sql`. To re-apply (idempotent for options, NOT for subscription_plans):

```bash
scp deploy/setup-pricing.sql ec2-user@<ip>:~/setup.sql
ssh ec2-user@<ip> 'docker run --rm -v ~/setup.sql:/sql.sql postgres:16-alpine psql \
  "postgresql://zeus_admin:$ZEUS_PASSWORD_URL_ENCODED@zeus.bio-matrix.io:5432/zeus?sslmode=require" \
  -f /sql.sql'
```

### Subscription tiers

| Tier | Slug | ¥/month | Displayed quota | upgrade_group |
|------|------|---------|----------------|---------------|
| 新人特惠 | trial | 9.9 | $19.9 | `trial` |
| 开发者版 | dev | 299 | $360 | `dev` |
| 专业生产版 | pro | 499 | $650 | `pro` |
| 旗舰团队版 | team | 999 | $1,400 | `team` |

Internal quota formula: `displayed_$ × 500000` (new-api quota units).

### GroupGroupRatio matrix

```
                arbitrage   default
default (free)    1.0         1.0
trial             1.0        16.0
dev               0.5         9.5
pro               0.11       10.0
team              0.07       10.2
```

- `arbitrage` channel group = our cost ≈ 0 (via sub2api OAuth arbitrage)
- `default` channel group = direct pay-per-use
- Ratios in `default` column equal the per-tier INFLATION FACTOR (to make wallet deplete at real cost rate) plus small markup for trial/dev/pro

After changing options via SQL, **restart new-api** to reload:
```bash
docker compose restart new-api
```

### Model ratio (official prices)

`ModelRatio` stored as `official_usd_per_1M / 2` (new-api: 1 unit = $2/1M tokens):
- gpt-5.4: 1.25 ($2.5/M)
- gpt-5.4-mini: 0.375 ($0.75/M)
- claude-sonnet-4: 1.5 ($3/M)
- deepseek-chat: 0.14 ($0.28/M)
- seedance-2-0: 3.15 (calibrated to ¥1/sec at 108,900 tokens/5sec)

---

## 6. Emergency Contacts & Recovery

- AWS account: 249744804493 (us-east-1)
- Route53 zone: `bio-matrix.io` (ID `Z02893803142IW0E545HE`)
- EC2: `i-0b0f6cf74bc78b251`, Security group `sg-0913be680a05d8837`
- EBS volume: 30GB gp3 (expand via `aws ec2 modify-volume --size 40` if needed)
- Remote PG: `zeus.bio-matrix.io:5432` (owned by zeus admin; confirm quota before heavy writes)
- GitHub: `Alan-actech/new-api` fork

### If EC2 is irrecoverably broken

Stack can be rebuilt from:
1. Source: fork at Alan-actech/new-api `upgrade/v1.0.0-rc.11`
2. Deploy script: `deploy/user-data.sh` (though now outdated — needs remote PG config)
3. Pricing SQL: `deploy/setup-pricing.sql` (re-applies all ratios + plans)
4. Caddy config: in `/etc/caddy/Caddyfile` (can be re-written)

Database **is safe** — data is at `zeus.bio-matrix.io` in schemas `galapi_newapi` + `galapi_sub2api`.

---

## 7. Known Issues

See `memory/known_issues.md` for full list. Highlights:
- Disk fills up from docker build cache — always `docker builder prune -af` after builds
- Reasoning models (MiniMax M2.7, etc) + streaming → 0 tokens returned; use non-stream
- Seedance 1080p requires separate Volcengine account activation
- Homepage `?plan=` URL param lost through login redirect (only affects logged-out users)
- new-api runs as `zeus_admin` (needs table ownership for GORM migrations)
