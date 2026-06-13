FROM mcr.microsoft.com/playwright:v1.47.0-jammy

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Expose the port the app runs on (Cloud Run uses 8080 by default, but injects the PORT env var)
EXPOSE 3000

# Start the server using the start script
CMD ["npm", "start"]
