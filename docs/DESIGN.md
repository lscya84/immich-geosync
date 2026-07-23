# Immich GeoSync Design

## 목표

Immich GeoSync는 Immich 사진의 좌표 기반 위치 정보를 한국어 주소로 보정하고, 반복 보정이 필요한 좌표 클러스터를 Admin UI에서 운영자가 직접 관리할 수 있게 한다.

## 요구사항

- worker는 Immich PostgreSQL의 사진 좌표를 읽어 `asset_exif`의 주소 정보를 보정한다.
- admin은 클러스터 맵 에디터, 워커상태, 설정을 메뉴형 UI로 제공한다.
- admin 설정 페이지는 운영 `.env` 파일을 수정할 수 있어야 한다.
- worker와 admin은 같은 `.env`를 사용하되, 민감 값은 UI에서 마스킹한다.
- worker는 대량 위치정보 업데이트를 제한된 크기의 배치로 나눠 PostgreSQL bind 한도를 안정적으로 지킨다.
- worker의 작업 쿼리와 로그 저장 쿼리는 별도 PostgreSQL 연결을 사용한다.
- worker는 동일 좌표를 먼저 집계하고, 고유 좌표를 입력 순서와 무관한 고정 공간격자로 군집화한다.
- 자동 역지오코딩 대표점은 산술평균 좌표가 아니라 실제 촬영 좌표 중 격자 중심에 가장 가까운 좌표를 사용한다.
- Point/Polygon override는 자동 클러스터 대표점이 아니라 개별 사진 좌표에 우선 적용한다.
- 설정 저장 후 실제 런타임 적용 시점이 명확해야 한다.
- worker 로그는 최신 로그가 보이는 위치로 자동 스크롤되고, 자동 새로고침/복사/다운로드를 제공한다.
- 운영 접속 주소는 `http://openclaw:3030/admin/`이다.
- Immich `v3`의 edited asset 파일 구조를 따라 어드민 미리보기는 현재 편집 상태와 최대한 같은 preview/thumbnail을 우선 선택해야 한다.
- Immich `v3`의 `lockedProperties` 중 좌표 잠금(`latitude`, `longitude`)은 수동 좌표 이동에서 존중해야 한다.
- 어드민 preview 경로는 기본 업로드 루트뿐 아니라 `UPLOAD_LOCATION` 기반 custom media path도 허용해야 한다.

## 가정

- GitHub repository 이름은 `immich-geosync`다.
- 운영 배포 경로는 `/docker/immich/immich-geosync`다.
- Immich compose 루트의 `.env`를 worker와 admin이 공유한다.
- DB 보조 테이블명은 기존 `custom_geo_*` 계열을 유지한다.
- Secret 값은 빈 값으로 저장하면 기존 값을 유지한다.

## Architecture

- Worker: Node.js `updater.js`
- Admin Backend: Express `admin-server.js`
- Admin Frontend: static HTML/CSS/JavaScript under `admin/`
- Database: 기존 Immich PostgreSQL + GeoSync 보조 테이블
- Runtime: Docker compose

## Runtime Containers

| Compose service | Container | Command | Role |
|---|---|---|---|
| `immich-geosync-worker` | `immich_geosync_worker` | `node updater.js` | 주기적 좌표 보정 worker |
| `immich-geosync-admin` | `immich_geosync_admin` | `node admin-server.js` | Admin UI/API |

## Environment File Flow

운영 구조는 하나의 `.env`를 두 컨테이너가 공유한다.

```text
/docker/immich/.env
  ├─ immich-geosync-worker -> /app/.env:ro
  └─ immich-geosync-admin  -> /app/.env:rw
```

Admin 설정 API는 `ADMIN_ENV_PATH`의 파일을 직접 읽고 쓴다. 운영 기본값은 `/app/.env`다.

## Settings Behavior

설정 페이지의 저장 대상은 worker/admin 공통 `.env`다. 저장 직후 설정 페이지에는 새 값이 표시된다. 그러나 worker와 admin의 실제 런타임 설정은 프로세스 시작 시점의 `process.env`에서 읽기 때문에 관련 컨테이너를 재기동해야 반영된다.

| Key | Worker | Admin |
|---|---|---|
| `INTERVAL_HOURS` | 재기동 후 worker 실행 주기에 적용 | worker 상태 표시는 다음 worker 실행 이후 갱신 |
| `STEP_DELAY_MS` | 재기동 후 API 처리 지연에 적용 | 직접 영향 없음 |
| `CLUSTER_RADIUS_METERS` | 재기동 후 클러스터링 반경에 적용 | 재기동 후 클러스터 조회/미리보기에 적용 |
| `APPEND_BUILDING_NAME` | 재기동 후 결과 주소의 건물명 포함 여부에 적용 | 재기동 후 중심점 주소 자동 채움의 건물명 선반영 여부에 적용 |
| `API_TIMEOUT_MS`, `NAVER_API_TIMEOUT_MS` | 재기동 후 API timeout에 적용 | 재기동 후 중심점 주소 조회 timeout에 적용 |
| `VWORLD_API_KEY` | 재기동 후 VWorld 조회에 적용 | 재기동 후 중심점 주소 조회에 적용 |
| `NAVER_CLIENT_ID` | 재기동 후 Naver 조회에 적용 | 재기동 후 지도 runtime config와 중심점 주소 조회에 적용 |
| `NAVER_CLIENT_SECRET` | 재기동 후 Naver 조회에 적용 | 재기동 후 중심점 주소 조회에 적용 |

운영자가 설정을 저장한 뒤에는 아래처럼 두 컨테이너를 함께 재기동하는 것을 기본 절차로 둔다.

```bash
docker compose restart immich-geosync-worker immich-geosync-admin
```

설정 저장을 완료한 후 반영하는 프로세스는 `docker compose restart <서비스명>`을 통해 간편하게 제어 가능하며, 모든 서비스를 내렸다 올릴 필요 없이 무중단으로 신속하게 반영할 수 있습니다.

## UI Structure

- Header: `Immich GeoSync Admin` 이름과 모바일 메뉴 버튼
- Sidebar: 화면 전환 메뉴
- Workspace:
  - 클러스터 맵 에디터: 규칙 목록, 지도, 클러스터/사진 미리보기
  - 워커상태: 현재 상태, 최근 실행, 작동 로그
  - 설정: `.env` 기반 설정 폼

워커상태 화면의 작동 로그는 최신 위치로 따라가며, 10초 자동 새로고침 토글과 로그 복사/다운로드 버튼을 제공한다.

## Data Model

주요 보조 테이블은 다음 역할을 한다.

- `custom_geo_override_rules`: polygon/point override rule
- `custom_geo_cluster_groups`: single-cluster group
- `custom_geo_worker_runs`: worker 실행 이력
- `custom_geo_worker_logs`: worker 로그
- `custom_geo_worker_state`: worker 현재 상태와 마지막 실행 설정 스냅샷

Worker는 `asset_exif` 갱신을 최대 1,000장 단위로 순차 처리한다. 실행 로그는 작업용 DB 연결과 분리된 전용 연결로 저장하고, 종료 시 진행 중인 로그 저장을 모두 기다린 뒤 연결을 닫는다.

자동 공간 클러스터는 `CLUSTER_RADIUS_METERS`를 격자 한 변의 길이로 사용한다. 위경도를 한국 중심 위도 36도를 기준으로 한 로컬 미터 좌표로 투영한 뒤 고정 격자 키를 만들기 때문에 DB 반환 순서가 달라도 같은 좌표는 같은 클러스터에 들어간다. 각 클러스터의 역지오코딩 대표점은 격자 중심과 가장 가까운 실제 고유 좌표를 사용한다. 동일 좌표에 속한 여러 asset은 한 번만 공간 계산하고 결과를 함께 반영한다.

수동 override와 single-cluster group은 자동 공간 클러스터링 전에 각 asset 좌표별로 판정한다. 따라서 자동 클러스터가 Polygon 경계를 걸쳐도 Polygon 바깥 asset에 override가 전파되지 않는다.

테이블명은 기존 운영 데이터와 호환을 위해 `custom_geo_*` 이름을 유지한다.

## Deployment

- Repository: `https://github.com/lscya84/immich-geosync`
- Docker image: `lscya84/immich-geosync`
- Admin URL: `http://openclaw:3030/admin/`
- Host port: `3030`
- Container port: `3030`

일괄 실행 시에는 `docker compose up -d` 명령어 하나로 Immich 서비스 그룹 전체를 통합하여 즉시 백업/운영 상태로 전환할 수 있습니다.

## Test Plan

- 정적 문법 확인: `node --check admin-server.js`, `node --check admin/app.js`
- Worker 정적 문법 확인: `node --check updater.js`
- 1,000장을 초과하는 단일 클러스터가 여러 DB update 배치로 분할되는지 확인
- worker 실행 중 `client.query()` 동시 실행 경고가 발생하지 않는지 확인
- 입력 순서가 달라도 공간 클러스터 키와 구성 결과가 같은지 확인
- 동일 좌표 asset이 하나의 좌표 bucket으로 집계되는지 확인
- 대표점이 산술평균 가상점이 아니라 실제 입력 좌표 중 하나인지 확인
- Polygon 경계 양쪽 asset이 override 단계에서 분리되는지 확인
- Admin health check: `/healthz`
- Admin page title: `<title>Immich GeoSync Admin</title>`
- Settings API: `/api/admin/settings`
- Worker API: `/api/admin/worker`
- Worker log controls: 최신 로그 자동 스크롤, 자동 새로고침, 복사, 다운로드
- 운영 배포 후 compose service/container 이름 확인

## Risks / Notes

- Admin 설정 저장은 파일 쓰기이며, 실행 중인 worker/admin process를 자동 재시작하지 않는다.
- Admin 컨테이너의 `.env` volume이 읽기 전용이면 설정 저장이 실패한다.
- Worker 컨테이너는 `.env`를 읽기 전용으로 마운트해도 된다.
- Docker Hub publish는 GitHub Actions secret `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`이 필요하다.
- Immich `v3`에서 `city/state/country`는 직접 유지되지만 preview/thumbnail 파생 파일은 편집 상태에 따라 달라질 수 있으므로 쿼리 우선순위가 중요하다.
