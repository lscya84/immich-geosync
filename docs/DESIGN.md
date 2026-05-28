# Immich GeoSync Design

## 목표

Immich GeoSync Admin 화면을 메뉴 기반 구조로 재구성해 클러스터 맵 에디터, 워커상태, 설정이 한 좌측 패널에 섞이지 않게 한다.

## 요구사항

- 상단 헤더와 좌측 메뉴가 중복되어 화면을 답답하게 만들지 않도록 정리한다.
- 좌측에는 주요 메뉴만 둔다.
- 메뉴는 `클러스터 맵 에디터`, `워커상태`, `설정`으로 구성한다.
- 각 메뉴는 별도 화면처럼 전환된다.
- 기존 지도 편집, 규칙 목록, 워커 로그, 환경 설정 API 기능은 유지한다.

## 가정

- GitHub repository 이름은 `immich-geosync`로 정리한다.
- 사용자 접속 주소는 `http://openclaw:3030/admin/`이다.
- 민감한 환경 변수 값은 기존처럼 마스킹하고, 빈 값 저장 시 기존 값을 유지한다.

## Architecture

- Backend: Express admin server
- Frontend: static HTML/CSS/JavaScript
- Database: 기존 Immich PostgreSQL 및 admin 보조 테이블
- Runtime: Docker compose 운영 배포

## UI 구조

- Header: 제품명과 모바일 메뉴 버튼만 표시한다.
- Sidebar: 화면 전환 메뉴 전용으로 사용한다.
- Workspace:
  - Map Editor: 규칙 목록 패널과 지도
  - Worker Status: 워커 상태, 최근 실행, 작동 로그
  - Settings: `.env` 기반 설정 폼

## 테스트 계획

- 정적 문법 확인: `node --check admin-server.js`, `node --check admin/app.js`
- 로컬 서버 응답 확인: `/healthz`
- UI 파일이 정상 서빙되는지 확인한다.
- 운영 배포 후 `http://openclaw:3030/admin/`에서 메뉴 전환과 API 응답을 확인한다.

## 배포

- 변경 사항을 commit/push한다.
- plex LXC의 운영 경로에서 pull 후 Docker compose로 admin/worker를 재빌드한다.
