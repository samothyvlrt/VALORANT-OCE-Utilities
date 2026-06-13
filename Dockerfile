FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
VOLUME ["/app/data"]
CMD ["npm", "start"]
