FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY src ./src
# On ne tourne pas en root.
RUN chown -R node:node /app
USER node
ENV NODE_ENV=production
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3002)+'/health',{headers:{'x-api-key':process.env.API_KEY||''}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
