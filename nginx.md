sudo apt install nginx

sudo nano /etc/nginx/sites-available/myapp


server {
    listen 80;

    server_name your-domain.com;

    location /app1 {
        proxy_pass http://localhost:5000/app1;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /app2 {
        proxy_pass http://localhost:5000/app2;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /app3 {
        proxy_pass http://localhost:5000/app3;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Redirect root (optional, for main app)
    location / {
        proxy_pass http://localhost:5000;
    }
}
