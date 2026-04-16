# Production Deployment Guide: SUBDOMAIN_SAAS_DEMO

Follow these steps to deploy the application with wildcard subdomain support.

---

## 1. DNS Setup (Wildcard Record)

You must create a wildcard A record pointing to your server's IP.

*   **Type**: `A`
*   **Name**: `*` (or `*.yourdomain.com`)
*   **Value**: `YOUR_SERVER_IP`

*Note: This allows `anytenant.yourdomain.com` to resolve to your server.*

---

## 2. SSL Setup (Wildcard Certificate)

We recommend using **Certbot** with the **DNS-01 challenge** for wildcard certificates.

### Install Certbot
```bash
sudo apt update
sudo apt install certbot
```

### Request Wildcard Certificate (Wait for DNS Propagations)
```bash
sudo certbot certonly --manual --preferred-challenges dns -d *.yourdomain.com -d yourdomain.com
```

---

## 3. Nginx Configuration

1.  Copy the provided [nginx.conf](file:///Users/arsh/Desktop/work/internship/intershipwork/SUBDOMAIN_SAAS_DEMO/deploy/nginx.conf) to `/etc/nginx/sites-available/subdomain-saas-demo`.
2.  Edit the file to replace `yourdomain.com` with your actual domain.
3.  Enable the site:
    ```bash
    sudo ln -s /etc/nginx/sites-available/subdomain-saas-demo /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl reload nginx
    ```

---

## 4. Deployment Automation

1.  Ensure you have Node.js and npm installed on your server.
2.  Optionally install **PM2** for process management:
    ```bash
    sudo npm install -g pm2
    ```
3.  Run the [deploy.sh](file:///Users/arsh/Desktop/work/internship/intershipwork/SUBDOMAIN_SAAS_DEMO/deploy/deploy.sh) script on every release.

---

## 5. Summary of logic

When a request for `arsh.yourdomain.com` hits your server:
1.  **DNS** resolves it to your IP.
2.  **Nginx** receives it, attaches the `Host` header, and proxies it to `localhost:3000`.
3.  **Next.js Proxy (`proxy.ts`)** extracts `arsh` from the `Host` header and rewrites the internal request to `/sites/arsh`.
4.  **Next.js App Router** renders `app/sites/[tenant]/page.tsx` with `{ tenant: "arsh" }`.
