FROM node:20-slim

# Build tools needed for better-sqlite3 native module + genvm-linter
RUN apt-get update && apt-get install -y python3 python3-pip make g++ && rm -rf /var/lib/apt/lists/*

# Install GenVM linter (used by POST /api/contracts/lint)
RUN pip3 install genvm-linter --break-system-packages

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 4000

CMD ["node", "dist/index.js"]
