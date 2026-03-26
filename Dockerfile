# Use the official, lightweight Node.js image
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first (they are now in the same folder as the Dockerfile!)
COPY package*.json ./

# Install only production dependencies
# This is the change we made earlier to avoid lockfile version issues
RUN npm install --omit=dev

# Copy the rest of your backend application code (server.js, etc.)
COPY . .

# Expose the port your server listens on (likely 3000 for local testing)
EXPOSE 3000

# Command to run your application
CMD ["node", "server.js"]