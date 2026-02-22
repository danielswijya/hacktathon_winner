# Deploy to Render NOW

## Backend (Server)

1. **https://render.com/dashboard** → New + → Web Service
2. Repo: `hacktathon_winner`
3. Settings:
   - Root Directory: `server`
   - Build: `npm install`
   - Start: `node index.js`

5. Create → Copy URL: `https://your-service.onrender.com`

## Frontend (Client)

1. New + → Static Site
2. Same repo
3. Settings:
   - Root Directory: `client`
   - Build: `npm install && npm run build`
   - Publish: `dist`
4. Create

## Connect Frontend to Backend

In `client/src/App.jsx`, add at top:
```javascript
const API_URL = 'https://your-backend-url.onrender.com';
```

Replace all `/api/...` with `${API_URL}/api/...`

Done! 🚀
