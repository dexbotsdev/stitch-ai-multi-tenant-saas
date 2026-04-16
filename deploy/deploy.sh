#!/bin/bash

# Deployment Script for SUBDOMAIN_SAAS_DEMO
# Usage: ./deploy.sh

set -e

echo "--- Starting Deployment ---"

# 1. Install Dependencies
echo "Installing dependencies..."
npm install

# 2. Build the Application
echo "Building the Next.js application..."
npm run build

# 3. Apply Environment Variables (Example)
# cp .env.production .env.local

# 4. Restart the Next.js Service (Example with PM2)
if command -v pm2 &> /dev/null
then
    echo "Restarting application with PM2..."
    pm2 restart subdomain-saas-demo || pm2 start npm --name "subdomain-saas-demo" -- start
else
    echo "PM2 not found. Please restart your Next.js process manually using 'npm start'."
fi

# 5. Reload Nginx (Optional/Sudo)
echo "Reloading Nginx configuration..."
sudo nginx -t && sudo systemctl reload nginx

echo "--- Deployment Complete ---"
