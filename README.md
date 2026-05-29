# Immich GeoSync

Immich 사진의 대한민국 위치 정보를 한국어 주소로 보정하고, 반복 보정이 필요한 좌표 클러스터를 Admin UI에서 편리하게 관리하는 **worker + admin 통합 모듈**입니다.

- GitHub: https://github.com/lscya84/immich-geosync
- Docker Hub: https://hub.docker.com/r/lscya84/immich-geosync
- Releases: https://github.com/lscya84/immich-geosync/releases

---

## 🏗️ 시스템 아키텍처

이 프로젝트는 하나의 코드베이스에서 두 개의 고유 컨테이너로 역할을 분할하여 구동합니다.

1. **`immich-geosync-worker` (보정 워커):** `updater.js`를 통해 DB에 저장된 사진 위경도 좌표를 분석하여 국내 주소(VWorld, Naver)로 변환/보정합니다.
2. **`immich-geosync-admin` (관리자 웹):** `admin-server.js`를 구동하여 브라우저 환경에서 지도 클러스터링 편집, 실시간 워커 관제, 환경 설정을 지원합니다.

두 서비스는 같은 Immich PostgreSQL 데이터베이스와 공유 `.env` 환경 변수 설정을 마운트하여 긴밀하게 협업합니다.

```text
/docker/immich/.env
  ├─ immich-geosync-worker (읽기 전용 마운트: /app/.env:ro)
  └─ immich-geosync-admin  (읽기/쓰기 마운트: /app/.env)
```

---

## ⚙️ 스마트한 환경 설정 (Web UI 지원)

기존 서버의 `.env` 텍스트 파일을 직접 수정할 필요 없이, **Admin Web의 '설정' 탭**에서 직접 주요 변수들을 조절할 수 있습니다.

* **완벽한 보안 마스킹:** VWorld API Key, NAVER Client ID/Secret 등 민감 정보는 UI 상에서 마스킹(`****`) 처리되어 가려집니다. 값을 비워둔 채 저장하면 기존 설정 값을 안전하게 보존합니다.
* **입력값 유효성 검증:** 시간 주기, 반경 미터(m) 값 등은 엔진에서 안전하게 정수 형식 등으로 사전 검증 후 저장하므로 파일 손상 위험이 없습니다.
* **반영 기준:** 설정을 Web UI에서 변경/저장한 뒤 아래의 재기동 명령을 수행하면 새로운 설정이 런타임에 완벽히 적용됩니다.

```bash
# Web UI에서 설정을 저장한 후 적용을 위해 두 컨테이너를 함께 재기동합니다.
docker compose restart immich-geosync-worker immich-geosync-admin
```

---

## 🚀 빠른 시작 (Quick Start)

### 1) `.env` 환경 변수 준비
Immich compose 루트의 `.env` 파일에 하단 설정을 추가합니다.

```env
DB_HOSTNAME=immich_postgres
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_db_password_here
DB_DATABASE_NAME=immich

# 국내 역지오코딩 API 설정
VWORLD_API_KEY=your_vworld_api_key_here
NAVER_CLIENT_ID=your_naver_client_id_here
NAVER_CLIENT_SECRET=your_naver_client_secret_here

# 동작 제어 설정
INTERVAL_HOURS=24
STEP_DELAY_MS=100
CLUSTER_RADIUS_METERS=15
APPEND_BUILDING_NAME=true
API_TIMEOUT_MS=10000
NAVER_API_TIMEOUT_MS=10000

# Admin UI 포트 및 경로
ADMIN_PORT=3030
ADMIN_ENV_PATH=/app/.env
UPLOAD_LOCATION=/path/to/immich/upload
```

### 2) docker-compose.yml 서비스 구성
기존 Immich `docker-compose.yml` 파일 내부의 `services` 단 하단에 아래 두 서비스를 추가합니다.

```yaml
  immich-geosync-worker:
    container_name: immich_geosync_worker
    image: lscya84/immich-geosync:latest
    restart: always
    volumes:
      - ./.env:/app/.env:ro
    environment:
      - DB_HOSTNAME=immich_postgres
    depends_on:
      - immich-postgres

  immich-geosync-admin:
    container_name: immich_geosync_admin
    image: lscya84/immich-geosync:latest
    command: ["node", "admin-server.js"]
    restart: always
    ports:
      - "3030:3030"
    volumes:
      - ./.env:/app/.env
      - ${UPLOAD_LOCATION}:/usr/src/app/upload:ro
    environment:
      - DB_HOSTNAME=immich_postgres
      - ADMIN_PORT=${ADMIN_PORT:-3030}
      - ADMIN_ENV_PATH=/app/.env
      - UPLOAD_LOCATION=/usr/src/app/upload
    depends_on:
      - immich-postgres
```

### 3) 일괄 기동 및 접속
도커 컴포즈 명령을 활용해 **한 번의 입력으로 모든 프로세스를 한 번에 기동**할 수 있습니다.

```bash
# 전체 구성요소(기존 Immich + GeoSync) 일괄 백그라운드 시작
docker compose up -d
```

서비스가 정상적으로 켜졌다면 브라우저를 열고 관리 페이지로 접속합니다:
👉 **`http://<서버IP>:3030/admin/`**

---

## 🛠️ 주요 운영 명령어

### 워커 강제 전체 사진 전수 재처리
기존에 이미 주소 보정이 끝난 사진들까지 완전히 새 좌표 기준으로 강제 리스캔할 때 실행합니다:
```bash
docker compose exec immich-geosync-worker node updater.js --force
```

### 캐시 수동 만료 소거
```bash
docker compose exec immich-geosync-worker node updater.js --clear-cache-only
```

### 개별 좌표 결과 사전 프리뷰 테스트
```bash
docker compose exec immich-geosync-worker node reverse_geocode.js 37.5665 126.9780
```
