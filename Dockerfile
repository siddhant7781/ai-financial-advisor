FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Install dependencies first (use package.json caching)
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --production

# Copy source
COPY . .

# Build-time defaults
ENV PORT 8080

EXPOSE 8080

CMD [ "node", "server.js" ]
