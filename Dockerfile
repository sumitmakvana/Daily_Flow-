# Stage 1: Build the application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and install all dependencies
COPY package*.json ./
COPY package-lock.json ./
RUN npm install

# Copy the source code and build the production bundle
COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN npm run build

# Stage 2: Production runner
FROM node:22-alpine AS runner

WORKDIR /app

# Set environment to production and define default port
ENV NODE_ENV=production
ENV PORT=8080

# Copy package files and install only production dependencies
COPY package*.json ./
COPY package-lock.json ./
RUN npm install --omit=dev

# Copy the compiled production build from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/runner.js ./runner.js

# Expose the port where the TanStack Start app will listen
EXPOSE 8080

# Start the compiled TanStack Start server via the runner
CMD ["node", "runner.js"]
