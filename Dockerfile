FROM node:22-alpine

WORKDIR /app

# Install dependencies first (better layer caching). The actual source is
# bind-mounted at runtime via docker-compose.
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 8202

CMD ["npm", "run", "dev"]
