#!/bin/bash

# Help function
display_help() {
  echo "Usage: $0 -d <domain_name> -e <certbot_email> [-b <auth_username:auth_password>]"
  echo
  echo "  -d <domain_name>       The domain name for SSL setup."
  echo "  -e <certbot_email>     The email for Certbot registration."
  echo "  -b <username:password> Optional. Enables BasicAuth with specified username and password."
  echo "  -h                     Display this help message."
}

# Parse parameters
while getopts "d:e:b:h" opt; do
  case $opt in
    d) domain_name="$OPTARG" ;;
    e) certbot_email="$OPTARG" ;;
    b) basic_auth="$OPTARG" ;;
    h) display_help; exit 0 ;;
    *) display_help; exit 1 ;;
  esac
done

# Check for mandatory parameters
if [[ -z "$domain_name" || -z "$certbot_email" ]]; then
  echo "Error: Missing required parameters."
  display_help
  exit 1
fi

# Exit script on error
set -e

# Check for root privileges
if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root." >&2
  exit 1
fi

# Update and install required packages
echo "Updating system and installing required packages..."
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx git wget curl

# Check if Docker is installed; install if not
if ! command -v docker &> /dev/null; then
  echo "Docker is not installed. Installing Docker..."
  curl -fsSL "https://get.docker.com/" | sh
fi

# Check if Docker Compose (v2 syntax: docker compose) is installed; install if not
if ! docker compose version &> /dev/null; then
  echo "Docker Compose is not installed. Installing Docker Compose..."
  curl -fsSL "https://get.docker.com/" | sh
fi

# Create docker-compose.yml
cat > docker-compose.yml <<EOL
version: "3.8"

services:
  muttley:
    image: mtimani/muttley
    container_name: muttley
    restart: always
    ports:
      - "3000:3000"
    environment:
      - ENV=PRODUCTION
EOL

if [[ -n "$basic_auth" ]]; then
  IFS=":" read -r auth_username auth_password <<< "$basic_auth"
  cat >> docker-compose.yml <<EOL
      - AUTH_USERNAME=$auth_username
      - AUTH_PASSWORD=$auth_password
EOL
fi

cat >> docker-compose.yml <<EOL
    volumes:
      - ./data:/data
    entrypoint: ["/bin/bash", "/server/run.sh"]
EOL

# Start Docker Compose
echo "Starting Docker Compose..."
docker compose up -d

# Configure Nginx for the domain
echo "Configuring Nginx for domain $domain_name..."
nginx_config="/etc/nginx/sites-available/$domain_name"

cat > "$nginx_config" <<EOL
server {
    listen 80;
    server_name $domain_name;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOL

# Enable the Nginx site configuration
echo "Enabling Nginx site configuration..."
sudo ln -sf "$nginx_config" /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Obtain SSL certificate using Certbot
echo "Obtaining SSL certificate for $domain_name..."
sudo certbot --nginx -d "$domain_name" --non-interactive --agree-tos --email "$certbot_email"

# Add client_max_body_size to Nginx configuration
echo "Adding client_max_body_size 100G to Nginx configuration..."
sudo sed -i '/server_name/a \    client_max_body_size 100G;' "$nginx_config"

# Add timeout settings to Nginx configuration
echo "Adding timeout settings to Nginx configuration..."
sudo sed -i '/server_name/a \    proxy_read_timeout 36000s;' "$nginx_config"
sudo sed -i '/server_name/a \    proxy_connect_timeout 36000s;' "$nginx_config"
sudo sed -i '/server_name/a \    proxy_send_timeout 36000s;' "$nginx_config"
sudo sed -i '/server_name/a \    send_timeout 36000s;' "$nginx_config"

sudo nginx -t
sudo systemctl reload nginx

# Automate certificate renewal
echo "Automating certificate renewal..."
if ! sudo crontab -l | grep -q "certbot renew"; then
  (sudo crontab -l 2>/dev/null; echo "0 0 * * * certbot renew --quiet && systemctl reload nginx") | sudo crontab -
fi

echo "Nginx reverse proxy with SSL is successfully set up for $domain_name!"
