# Client Dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy application code
COPY . .

# Build the application
RUN npm run build

# Expose port (Vite preview or dev server)
EXPOSE 5173

# Start the app
CMD ["npm", "run", "preview"]