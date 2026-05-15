FROM node:20-alpine
# Build version: 2026-05-15-fix-override
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3001
CMD ["node", "scripts/servidor.js"]
