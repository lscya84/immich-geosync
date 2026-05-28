# Immich GeoSync

Immich 사진의 대한민국 위치 정보를 한국어 주소로 보정하고, 반복 보정이 필요한 좌표 클러스터를 Admin UI에서 관리하는 **worker + admin 통합 레포**입니다.

- GitHub: https://github.com/lscya84/immich-geosync
- Docker Hub: https://hub.docker.com/r/lscya84/immich-geosync
- Releases: https://github.com/lscya84/immich-geosync/releases

## 현재 구조

이 레포는 하나의 코드베이스에서 두 컨테이너를 분리해 실행합니다.

- `immich-geosync-worker`: `updater.js`를 실행하는 실제 보정 워커
- `immich-geosync-admin`: `admin-server.js`를 실행하는 관리자 UI/API

두 컨테이너는 같은 PostgreSQL과 같은 `.env` 파일을 사용합니다. 운영에서는 보통 Immich compose 루트의 `.env`를 두 컨테이너에 마운트합니다.

```text
/docker/immich/.env
  ├─ immich-geosync-worker: /app/.env:ro
  └─ immich-geosync-admin:  /app/.env:rw
```

Admin 설정 페이지는 `ADMIN_ENV_PATH`가 가리키는 파일을 직접 수정합니다. 운영 기본값은 `/app/.env`입니다.

## 기능

### Worker

- VWorld 우선, Naver 보조, mapping fallback 기반 역지오코딩
- 좌표 클러스터 단위 처리
- PostgreSQL 캐시와 negative cache 사용
- polygon override rule, single-cluster group 우선 적용
- worker 실행 상태, 최근 실행 기록, 로그를 DB에 저장

### Admin

- 클러스터 맵 에디터
- polygon rule 생성, 수정, 삭제
- single-cluster group 생성, 삭제
- rule/group 영향 범위 미리보기와 DB 반영
- worker 상태와 작동 로그 조회
- worker 로그 최신 위치 자동 스크롤
- worker 로그 자동 새로고침, 복사, 다운로드
- `.env` 기반 설정 조회/수정
- API key/secret 마스킹 표시

## 설정 적용 방식

설정 페이지에서 저장하는 값은 운영 `.env` 파일에 반영됩니다. 이 파일은 worker와 admin이 함께 사용합니다.

다만 Node 프로세스는 시작 시점에 `.env`를 읽습니다. 따라서 저장 후 실제 런타임 반영 기준은 아래와 같습니다.

| 설정 | 저장 위치 | Worker 적용 | Admin 적용 |
|---|---|---|---|
| `INTERVAL_HOURS` | `.env` | worker 컨테이너 재기동 후 적용 | worker 상태 표시에는 다음 worker 실행 이후 반영 |
| `STEP_DELAY_MS` | `.env` | worker 컨테이너 재기동 후 적용 | 직접 영향 없음 |
| `CLUSTER_RADIUS_METERS` | `.env` | worker 컨테이너 재기동 후 적용 | admin 컨테이너 재기동 후 클러스터 조회/미리보기에 적용 |
| `APPEND_BUILDING_NAME` | `.env` | worker 컨테이너 재기동 후 적용 | admin 컨테이너 재기동 후 중심점 주소 자동 채움에 적용 |
| `API_TIMEOUT_MS` | `.env` | worker 컨테이너 재기동 후 적용 | admin 컨테이너 재기동 후 주소 조회 API에 적용 |
| `NAVER_API_TIMEOUT_MS` | `.env` | worker 컨테이너 재기동 후 적용 | admin 컨테이너 재기동 후 주소 조회 API에 적용 |
| `VWORLD_API_KEY` | `.env` | worker 컨테이너 재기동 후 적용 | admin 컨테이너 재기동 후 중심점 주소 자동 채움에 적용 |
| `NAVER_CLIENT_ID` | `.env` | worker 컨테이너 재기동 후 적용 | admin 컨테이너 재기동 후 지도/주소 API에 적용 |
| `NAVER_CLIENT_SECRET` | `.env` | worker 컨테이너 재기동 후 적용 | admin 컨테이너 재기동 후 주소 조회 API에 적용 |

요약하면, **설정 저장은 worker/admin 공통 `.env`에 반영되지만 실제 적용은 관련 컨테이너 재기동 후 적용**됩니다. 설정 페이지의 목록은 `.env` 파일을 직접 읽기 때문에 저장 직후 새 값이 보입니다.

Secret 값은 빈칸으로 저장하면 기존 값을 유지합니다.

## 빠른 설치

### 1) `.env` 준비

Immich compose 루트의 `.env` 파일에 아래 값을 넣습니다.

```env
DB_HOSTNAME=immich_postgres
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_db_password_here
DB_DATABASE_NAME=immich

VWORLD_API_KEY=your_vworld_api_key_here
NAVER_CLIENT_ID=your_naver_client_id_here
NAVER_CLIENT_SECRET=your_naver_client_secret_here

INTERVAL_HOURS=24
STEP_DELAY_MS=100
CLUSTER_RADIUS_METERS=15
CLUSTER_YIELD_INTERVAL=1000
APPEND_BUILDING_NAME=true
API_TIMEOUT_MS=10000
NAVER_API_TIMEOUT_MS=10000
NOT_FOUND_CACHE_TTL_DAYS=30

ADMIN_PORT=3030
ADMIN_ENV_PATH=/app/.env
UPLOAD_LOCATION=/path/to/immich/upload
```

### 2) docker-compose 예시

```yaml
services:
  immich-geosync-worker:
    container_name: immich_geosync_worker
    image: lscya84/immich-geosync:latest
    restart: always
    volumes:
      - ./.env:/app/.env:ro
    environment:
      DB_HOSTNAME: immich_postgres
    depends_on:
      - immich_postgres

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
      DB_HOSTNAME: immich_postgres
      ADMIN_PORT: ${ADMIN_PORT:-3030}
      ADMIN_ENV_PATH: /app/.env
      UPLOAD_LOCATION: /usr/src/app/upload
    depends_on:
      - immich_postgres
```

Admin에서 설정을 수정하려면 admin 컨테이너의 `.env` 마운트는 읽기 전용(`:ro`)이 아니어야 합니다. worker 컨테이너는 읽기 전용(`:ro`)으로 두는 것을 권장합니다.

## 실행

### worker

```bash
docker compose up -d immich-geosync-worker
```

### admin

```bash
docker compose up -d immich-geosync-admin
```

브라우저:

```text
http://openclaw:3030/admin/
```

## 설정 변경 후 재기동

Admin 설정 페이지에서 `.env`를 저장한 뒤에는 바뀐 값이 필요한 컨테이너를 재기동합니다.

```bash
docker compose restart immich-geosync-worker immich-geosync-admin
```

worker 주기, API 키, 건물명 자동 추가처럼 worker와 admin이 모두 참조하는 값은 두 컨테이너를 함께 재기동하는 것이 가장 확실합니다.

## 자주 쓰는 명령

### worker 로그

```bash
docker compose logs -f --tail=100 immich-geosync-worker
```

### admin 로그

```bash
docker compose logs -f --tail=100 immich-geosync-admin
```

### 기존 사진까지 전체 재처리

```bash
docker compose exec immich-geosync-worker node updater.js --force
```

### 캐시만 삭제 후 종료

```bash
docker compose exec immich-geosync-worker node updater.js --clear-cache-only
```

### 단건 좌표 확인

```bash
docker compose exec immich-geosync-worker node reverse_geocode.js 35.354921 127.558729
```

### admin 서버 직접 실행

```bash
docker compose exec immich-geosync-admin node admin-server.js
```

## 운영 배포 메모

- 운영 GitHub repo: `lscya84/immich-geosync`
- 운영 경로 예시: `/docker/immich/immich-geosync`
- 운영 접속 URL: `http://openclaw:3030/admin/`
- DB 보조 테이블 이름은 기존 `custom_geo_*` 계열을 유지합니다. 프로그램명 변경과 무관하게 운영 데이터 마이그레이션 위험을 줄이기 위한 선택입니다.
- 안정 배포용 순수 워커는 별도 레포 `immich-ko-reverse-geocoding`에 유지합니다.
