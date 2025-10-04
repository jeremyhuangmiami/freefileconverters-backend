FROM node:18-bullseye

RUN apt-get update && apt-get install -y \
    imagemagick \
    ffmpeg \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY server.js ./
RUN mkdir -p uploads

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "start"]
