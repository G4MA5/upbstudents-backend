FROM node:20-alpine
# git : certaines dépendances de Baileys sont téléchargées depuis GitHub.
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY src ./src
# auth = session WhatsApp, data = file d'attente sauvegardée (deux volumes en production).
# On ne tourne pas en root : le dossier appartient à l'utilisateur "node".
RUN mkdir -p auth data && chown -R node:node /app
USER node
ENV NODE_ENV=production
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/health',{headers:{'x-api-key':process.env.API_KEY||''}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
