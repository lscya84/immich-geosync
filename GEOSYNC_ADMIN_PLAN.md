# Immich GeoSync Admin Plan

## 현재 목표

Immich GeoSync Admin은 자동 역지오코딩 worker를 운영자가 직접 보정하고 관찰할 수 있는 관리 화면이다.

핵심 역할은 세 가지다.

1. 지도에서 현재 클러스터와 캐시/주소 상태를 확인한다.
2. 특정 좌표 영역을 수동 규칙 또는 단일 클러스터로 저장해 반복 보정을 자동화한다.
3. worker 상태, 로그, 주요 `.env` 설정을 Admin에서 확인하고 수정한다.

## 현재 구현 범위

### 클러스터 맵 에디터

- 클러스터 목록/지도 조회
- polygon override rule 생성, 수정, 삭제
- single-cluster group 생성, 삭제
- rule/group 영향 범위 미리보기
- 특정 rule/group 기준 asset_exif 재반영
- 클러스터 중심점 주소 자동 채움
- 샘플 썸네일/미리보기 조회

### 워커상태

- 현재 worker 상태 조회
- 최근 worker 실행 이력 조회
- worker 작동 로그 조회
- 최신 로그 자동 스크롤
- 10초 자동 새로고침 토글
- 로그 복사와 다운로드
- worker 실행 시점의 설정 스냅샷 저장

### 설정

- `ADMIN_ENV_PATH`가 가리키는 `.env` 파일 조회/수정
- Secret 값 마스킹 표시
- Secret 입력칸을 비워 저장하면 기존 값 유지
- 지원 설정:
  - `INTERVAL_HOURS`
  - `STEP_DELAY_MS`
  - `CLUSTER_RADIUS_METERS`
  - `APPEND_BUILDING_NAME`
  - `API_TIMEOUT_MS`
  - `NAVER_API_TIMEOUT_MS`
  - `VWORLD_API_KEY`
  - `NAVER_CLIENT_ID`
  - `NAVER_CLIENT_SECRET`

## 설정 적용 원칙

Admin 설정 페이지는 공통 `.env` 파일을 수정한다.

운영 compose 기준:

```text
/docker/immich/.env
  ├─ immich-geosync-worker -> /app/.env:ro
  └─ immich-geosync-admin  -> /app/.env:rw
```

저장 직후 설정 페이지에는 새 값이 표시되지만, 실제 worker/admin 동작은 각 Node process가 시작될 때 읽은 `process.env`를 기준으로 한다. 따라서 설정 저장 후에는 관련 컨테이너를 재기동해야 한다.

기본 운영 절차:

```bash
docker compose restart immich-geosync-worker immich-geosync-admin
```

## 우선순위

위치 보정 우선순위는 아래 순서를 따른다.

1. manual override rule
2. single-cluster group
3. cache hit
4. reverse geocode API
5. mapping fallback

즉 사람이 지정한 규칙이 자동 결과보다 우선한다.

## DB 보조 테이블

- `custom_geo_override_rules`
- `custom_geo_cluster_groups`
- `custom_geo_worker_runs`
- `custom_geo_worker_logs`
- `custom_geo_worker_state`

프로그램명은 Immich GeoSync로 정리했지만, DB 테이블명은 운영 데이터 호환을 위해 기존 `custom_geo_*` 이름을 유지한다.

## 운영 이름

- GitHub repo: `lscya84/immich-geosync`
- Docker image: `lscya84/immich-geosync`
- Worker service: `immich-geosync-worker`
- Admin service: `immich-geosync-admin`
- Worker container: `immich_geosync_worker`
- Admin container: `immich_geosync_admin`
- Admin URL: `http://openclaw:3030/admin/`
