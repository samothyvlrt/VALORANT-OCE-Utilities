FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Recompile native modules for Linux in case macOS binaries were copied in
RUN npm rebuild better-sqlite3
VOLUME ["/app/data"]
CMD ["npm", "start"]
