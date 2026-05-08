FROM node:18-alpine

WORKDIR /app

# 의존성 설치
COPY package.json ./
RUN npm install

# 스크립트 및 매핑 데이터 복사
COPY updater.js reverse_geocode.js mapping.json admin-server.js ./
COPY lib ./lib
COPY admin ./admin

# 기본 실행: 워커
CMD ["node", "updater.js"]
