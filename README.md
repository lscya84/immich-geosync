# Immich KO Geo Admin

Immich 사진의 대한민국 위치 정보를 보정하는 **워커 + 관리자 도구 통합 레포**입니다.

이 레포는 두 역할을 함께 포함합니다.

- **worker**: 좌표를 한국어 주소로 역지오코딩해 `asset_exif`를 보정
- **admin**: 클러스터 지도, polygon rule, 수동 override, 단일 클러스터 관리 UI 제공

- GitHub: https://github.com/lscya84/immich-ko-geo-admin
- Docker Hub: https://hub.docker.com/r/lscya84/immich-ko-geo-admin
- Releases: https://github.com/lscya84/immich-ko-geo-admin/releases

## 구성

### 1) Worker

기본 실행은 `updater.js` 입니다.

- VWORLD 우선 + Naver 보조 + mapping fallback
- 클러스터 단위 처리
- 메모리 + PostgreSQL 캐시
- negative cache 지원
- custom override rule / single-cluster rule 반영

### 2) Admin

`admin-server.js` 는 운영용 지도 UI/API 입니다.

- polygon rule 생성/수정/삭제
- 클러스터 지도 보기
- polygon 중심점 기준 주소 자동 채움
- 샘플 썸네일 미리보기
- 수동 override / single-cluster rule 적용

## 추천 운영 방식

이 레포는 **레포는 하나, 실행은 둘**로 쓰는 것을 권장합니다.

- `immich-ko-geo-worker` → worker 전용 컨테이너
- `immich-ko-geo-admin` → admin 전용 컨테이너

즉, 같은 코드베이스를 쓰되 컨테이너를 분리해 운영합니다.

## 빠른 설치

### 1) `.env` 준비

Immich에서 실제로 사용하는 `.env` 파일에 아래 값을 넣습니다.

```env
VWORLD_API_KEY=복사한_VWORLD_KEY
NAVER_CLIENT_ID=복사한_ID
NAVER_CLIENT_SECRET=복사한_SECRET
DB_PORT=5432
INTERVAL_HOURS=24
STEP_DELAY_MS=100
CLUSTER_RADIUS_METERS=15
APPEND_BUILDING_NAME=true
NAVER_API_TIMEOUT_MS=10000
NOT_FOUND_CACHE_TTL_DAYS=30
ADMIN_PORT=3030
```

### 2) docker-compose 예시

```yaml
services:
  immich-ko-geo-worker:
    container_name: immich_ko_geo_worker
    image: lscya84/immich-ko-geo-admin:v1.4.2
    restart: always
    volumes:
      - ./.env:/app/.env:ro
    environment:
      DB_HOSTNAME: immich_postgres
      DB_PORT: ${DB_PORT:-5432}
      DB_USERNAME: ${DB_USERNAME}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_DATABASE_NAME: ${DB_DATABASE_NAME:-immich}
    depends_on:
      - immich_postgres

  immich-ko-geo-admin:
    container_name: immich_ko_geo_admin
    image: lscya84/immich-ko-geo-admin:v1.4.2
    command: ["node", "admin-server.js"]
    restart: always
    ports:
      - "3030:3030"
    volumes:
      - ./.env:/app/.env:ro
      - ${UPLOAD_LOCATION}:/usr/src/app/upload:ro
    environment:
      DB_HOSTNAME: immich_postgres
      DB_PORT: ${DB_PORT:-5432}
      DB_USERNAME: ${DB_USERNAME}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_DATABASE_NAME: ${DB_DATABASE_NAME:-immich}
      ADMIN_PORT: ${ADMIN_PORT:-3030}
      UPLOAD_LOCATION: /usr/src/app/upload
    depends_on:
      - immich_postgres
```

## 실행

### worker

```bash
docker compose up -d immich-ko-geo-worker
```

### admin

```bash
docker compose up -d immich-ko-geo-admin
```

브라우저:

```text
http://<host>:3030/admin/
```

## 자주 쓰는 명령

### worker 로그

```bash
docker compose logs -f --tail=100 immich-ko-geo-worker
```

### admin 로그

```bash
docker compose logs -f --tail=100 immich-ko-geo-admin
```

### 기존 사진까지 전체 재처리

```bash
docker compose exec immich-ko-geo-worker node updater.js --force
```

### 캐시만 삭제 후 종료

```bash
docker compose exec immich-ko-geo-worker node updater.js --clear-cache-only
```

### 단건 좌표 확인

```bash
docker compose exec immich-ko-geo-worker node reverse_geocode.js 35.354921 127.558729
```

### admin 서버 직접 실행

```bash
docker compose exec immich-ko-geo-admin node admin-server.js
```

## 배포 메모

- 이 레포는 **통합 레포**입니다.
- 안정 배포용 순수 워커는 별도 레포 `immich-ko-reverse-geocoding` 에 유지합니다.
- 이 레포에서는 worker/admin 기능을 함께 발전시키되, 운영에서는 두 서비스를 분리하세요.
