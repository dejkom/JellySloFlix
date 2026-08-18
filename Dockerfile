FROM node:20-alpine

WORKDIR /app

# Copy package definition
COPY package.json ./

# Copy application source code
COPY sync.js server.js ./
COPY public/ ./public/

# Default environment variables
ENV NODE_ENV=production \
    PORT=3849 \
    CONFIG_PATH=/config/config.json \
    MOVIES_DIR=/media/MoviesSloFlix \
    SHOWS_DIR=/media/ShowsSloFlix

# Expose Web GUI and Stream Bridge port
EXPOSE 3849

# Start Web GUI & Stream Resolver
CMD ["node", "server.js"]
