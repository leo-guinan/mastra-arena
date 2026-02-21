#!/bin/bash
# Deploy Arena agents to VPS
# Usage: bash deploy/setup.sh

set -e

VPS="root@178.156.207.21"
ARENA_DIR="/opt/arena"

echo "=== Arena Agent Deployment ==="

# 1. Create directory structure on VPS
echo "[1/6] Creating directories..."
ssh $VPS "mkdir -p $ARENA_DIR/{shared/tools,agents/{skippy,mando,walle,doc-brown,marvin}}"

# 2. Upload server + tools
echo "[2/6] Uploading server and tools..."
scp deploy/server.mjs $VPS:$ARENA_DIR/
scp deploy/tools/*.mjs $VPS:$ARENA_DIR/shared/tools/ 2>/dev/null || echo "  (no standalone tools yet)"

# 3. Upload agent SOUL files
echo "[3/6] Uploading agent configs..."
for agent in skippy mando walle doc-brown marvin; do
  scp deploy/agents/$agent/SOUL.md $VPS:$ARENA_DIR/agents/$agent/ 2>/dev/null || true
done

# 4. Create systemd services
echo "[4/6] Creating systemd services..."
PORTS=(4001 4002 4003 4004 4005)
AGENTS=(skippy mando walle doc-brown marvin)

for i in "${!AGENTS[@]}"; do
  AGENT=${AGENTS[$i]}
  PORT=${PORTS[$i]}
  
  ssh $VPS "cat > /etc/systemd/system/arena-$AGENT.service << EOF
[Unit]
Description=Arena Agent: $AGENT
After=network.target

[Service]
Type=simple
WorkingDirectory=$ARENA_DIR
ExecStart=/usr/bin/node $ARENA_DIR/server.mjs
Environment=AGENT_ID=$AGENT
Environment=PORT=$PORT
Environment=ARENA_DIR=$ARENA_DIR
Environment=OPENROUTER_API_KEY=\${OPENROUTER_API_KEY}
Environment=ARENA_API_KEY=\${ARENA_API_KEY}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF"
done

# 5. Nginx config
echo "[5/6] Configuring nginx..."
ssh $VPS "cat > /etc/nginx/sites-available/arena << 'EOF'
# Arena Agent APIs
server {
    listen 80;
    server_name arena.metaspn.network;
    
    # Meta endpoints
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
    
    # Per-agent routes
    location /skippy/ {
        proxy_pass http://127.0.0.1:4001/;
    }
    location /mando/ {
        proxy_pass http://127.0.0.1:4002/;
    }
    location /walle/ {
        proxy_pass http://127.0.0.1:4003/;
    }
    location /doc-brown/ {
        proxy_pass http://127.0.0.1:4004/;
    }
    location /marvin/ {
        proxy_pass http://127.0.0.1:4005/;
    }
}
EOF
ln -sf /etc/nginx/sites-available/arena /etc/nginx/sites-enabled/ 2>/dev/null
nginx -t && systemctl reload nginx"

# 6. Start services
echo "[6/6] Starting agents..."
ssh $VPS "systemctl daemon-reload"
for agent in "${AGENTS[@]}"; do
  ssh $VPS "systemctl enable arena-$agent && systemctl start arena-$agent" 2>/dev/null
  echo "  Started arena-$agent"
done

echo ""
echo "=== Deployment Complete ==="
echo "Endpoints:"
for i in "${!AGENTS[@]}"; do
  echo "  ${AGENTS[$i]}: https://arena.metaspn.network/${AGENTS[$i]}/health"
done
echo ""
echo "Monitor: ssh $VPS 'journalctl -u arena-skippy -f'"
