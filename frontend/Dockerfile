# Use official Node.js 20 Alpine image for a lightweight footprint
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package configuration files to cache dependency installation layer
COPY package*.json ./

# Install dependencies using clean install (npm ci is faster and more reliable in CI/Docker)
RUN npm ci

# Copy the rest of the frontend source code
COPY . .

# Expose Vite's default port
EXPOSE 5173

# Run Vite dev server, binding to all host interfaces (0.0.0.0) so it's accessible externally
CMD ["npm", "run", "dev", "--", "--host"]
