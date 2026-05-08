# Cluster Map Editor MVP Plan

## 목표

기존 역지오코딩 워커에 수동 운영 기능을 추가한다.

핵심 목표는 두 가지다.

1. 지도에서 현재 클러스터/캐시 상태를 확인할 수 있어야 한다.
2. 특정 좌표 영역을 수동으로 지정해서 해당 영역 안의 사진은 항상 지정한 위치명/건물명으로 처리할 수 있어야 한다.

## 왜 필요한가

현재 시스템은 좌표 클러스터링 + API/VWorld/Naver + 캐시 기반으로 동작한다.
이 구조는 자동화에는 좋지만, 아래 운영 요구를 직접 처리하기 어렵다.

- 같은 건물인데 좌표 오차로 클러스터가 나뉘는 경우
- 단지/공항/터미널/건물 내부처럼 사람이 정한 명칭을 강제하고 싶은 경우
- 반복적으로 같은 위치를 재보정해야 하는 경우
- 새 사진이 들어와도 같은 영역 규칙을 자동 적용하고 싶은 경우

따라서 단발성 클러스터 수정만이 아니라 "공간 규칙(override rule)"이 필요하다.

## 추천 방향

우선순위는 아래처럼 둔다.

1. manual override rule
2. cache hit
3. reverse geocode API
4. mapping fallback

즉 사람이 지정한 규칙이 항상 자동 결과보다 우선한다.

## MVP 범위

### 포함

- 지도 기반 관리자 페이지
- 클러스터 목록 조회 API
- 캐시된 클러스터 지도 표시
- polygon override rule 생성/수정/삭제
- point override rule 생성/수정/삭제
- rule 영향 범위 미리보기
- 특정 rule을 기준으로 asset_exif 재반영 실행
- rule 적용 우선순위: override > cache > API > fallback

### 제외

- 클러스터 자동 병합 알고리즘 UI
- 클러스터 수동 분리 UI
- 사용자 인증/권한 시스템
- 사진 썸네일 브라우저
- 다중 사용자 감사 로그
- circle/rectangle 전용 편집기

## 기술 방향

현재 저장소는 Node 워커 중심이고 웹 앱 구조가 없다.
따라서 아래처럼 최소한으로 추가하는 것이 좋다.

- 관리자 API 서버: Node.js + Express
- 지도 UI: 정적 HTML + Leaflet
- DB: 기존 PostgreSQL 재사용
- geometry 저장: 1차는 JSONB / 추후 PostGIS 확장 가능

## 신규 파일/구조 제안

- `admin-server.js` : Express 서버 진입점
- `admin/` : 정적 UI 파일
  - `admin/index.html`
  - `admin/app.js`
  - `admin/styles.css`
- `lib/admin-db.js` : 관리자용 DB 로직
- `lib/override-rules.js` : 공간 규칙 평가 로직

## DB 스키마 초안

### 1) override rule

```sql
CREATE TABLE IF NOT EXISTS custom_geo_override_rules (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  rule_type VARCHAR NOT NULL, -- point | polygon
  geometry JSONB NOT NULL,
  country VARCHAR DEFAULT '대한민국',
  state VARCHAR DEFAULT '',
  city VARCHAR DEFAULT '',
  building VARCHAR DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### geometry 예시

point:
```json
{
  "type": "Point",
  "coordinates": [127.1123, 37.4021],
  "radiusMeters": 20
}
```

polygon:
```json
{
  "type": "Polygon",
  "coordinates": [
    [127.1, 37.4],
    [127.2, 37.4],
    [127.2, 37.5],
    [127.1, 37.5],
    [127.1, 37.4]
  ]
}
```

## API 초안

### GET /api/clusters
- 현재 asset_exif 기반 좌표 그룹 조회
- 응답에는 centroid, asset count, sample state/city 포함

### GET /api/rules
- override rule 목록 조회

### POST /api/rules
- 새 rule 생성

### PUT /api/rules/:id
- rule 수정

### DELETE /api/rules/:id
- rule 삭제

### POST /api/rules/:id/preview
- 해당 rule에 걸리는 asset 수/샘플 조회

### POST /api/rules/:id/apply
- 해당 rule을 asset_exif에 직접 반영

## 처리 로직 초안

워커가 클러스터 주소를 얻기 전에 아래를 먼저 확인한다.

1. 좌표가 enabled rule 안에 들어가는가?
2. 여러 rule에 걸리면 priority가 낮은 숫자 우선
3. rule이 있으면 해당 state/city/building으로 주소 구성
4. 없으면 기존 cache/API/fallback 흐름 유지

## UI 초안

### 왼쪽 패널
- rule 목록
- 생성 / 수정 / 삭제
- 이름
- 우선순위
- 적용 결과 미리보기

### 지도
- 클러스터 마커 표시
- rule polygon 표시
- 클릭 시 좌표/개수/샘플 위치명 표시
- draw mode로 polygon 또는 point 생성

### 하단/팝업
- rule 저장 폼
- state
- city
- building
- preview count
- apply button

## 구현 순서

### 1단계
- Express 서버 추가
- DB 테이블 생성 함수 추가
- rule CRUD API 추가

### 2단계
- Leaflet 기반 지도 UI 추가
- rule 생성/표시 연동

### 3단계
- preview/apply API 추가
- updater.js에 rule 우선 적용 추가

### 4단계
- README 문서화
- Docker 실행 경로 정리

## 주요 트레이드오프

### JSONB geometry
장점:
- 빠르게 시작 가능
- PostGIS 의존성 없음

단점:
- 공간 연산을 애플리케이션 코드에서 처리해야 함
- 대규모 데이터에는 비효율 가능

MVP는 JSONB로 시작하고, 필요하면 PostGIS로 올리는 것이 적절하다.

## 첫 구현 권장 범위

이번 브랜치 첫 PR은 아래만 담는 것이 좋다.

1. override rule 테이블
2. admin API 서버
3. 정적 지도 UI 골격
4. polygon/point rule 저장
5. rule 목록/표시

즉, "보는 것 + 규칙 저장"까지 먼저 만들고,
실제 updater 적용/클러스터 병합은 다음 단계로 나누는 편이 안전하다.
