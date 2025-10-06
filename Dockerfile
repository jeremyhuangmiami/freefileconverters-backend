FROM node:18-bullseye

# Update package lists and install dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    imagemagick \
    ffmpeg \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    fonts-liberation \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verify installations
RUN which convert && \
    which libreoffice && \
    which ffmpeg

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy application files
COPY server.js ./

# Create uploads directory with proper permissions
RUN mkdir -p uploads && chmod 777 uploads

# Expose port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
