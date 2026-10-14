# Anti-slop 린트 적용 설계

## 목표와 범위
- 기존 애플리케이션 동작·데이터·사용자 변경을 유지하며 JS/TS anti-slop 검사를 추가한다.
- 기존 린트 명령을 보존하고 전체 린트에 anti-slop을 연결한다. 기존 위반을 숨기거나 이번 설정 작업에서 대량 수정하지 않는다.
- Node.js 22 이상 개발/CI 환경에서 실행한다. Python 전용 실행 환경에는 Node 런타임 의존성을 추가하지 않는다.

## 구성과 검증
- `tools/oxlint/anti-slop/`: 검토한 원본 규칙, 라이선스, 정확한 출처.
- `.oxlintrc.json`: 일반 규칙 18개 및 native companion 규칙 1개를 error로 설정한다.
- 기존 ESLint/TypeScript 설정은 그대로 유지한다. Oxlint 기본 correctness 묶음은 새로 도입하지 않고 요청된 anti-slop 규칙만 켠다.
- `lint:anti-slop`: 전체 대상 검사, `lint`: 기존 린트와 anti-slop 모두 검사. 실패를 성공으로 바꾸거나 기준선을 숨기지 않는다.
- generated/build/vendor/설치된 agent tooling만 제외한다. 자체 소스와 테스트는 제외하지 않는다.
- 실제 설정 로딩, 규칙의 accepted/rejected 예제, 전체 린트, 기존 타입 검사 결과를 확인한다.
- 기존 코드 위반은 파일/행/규칙이 포함된 진단으로 보고한다. 이번 변경은 린트 설정과 개발 의존성만 포함한다.

## 설치와 사용
```sh
npm install
npm run lint:anti-slop
npm run lint
```

## 2026-10-15 적용 검사 결과

- 설정 로딩과 정상 예제는 성공, 위반 예제는 unknown 인자·반환 규칙으로 정상 거절.
- 전체 소스 anti-slop 검사: 기존 진단 657건, 종료 코드 1.
- 전체 lint 명령 종료 코드: 1. 설정 설치와 전체 소스 통과는 별개이며, 기존 위반을 숨기거나 자동으로 대량 수정하지 않았다.
- 앱 동작/데이터 변경 없음. 운영 이미지 빌드·배포는 해당 프로젝트의 품질 게이트를 따른다.

## CI 적용

- `.github/workflows/anti-slop.yml`이 push/PR/수동 실행에서 잠긴 의존성을 설치하고 전체 소스를 error 기준으로 검사한다.
- 기존 위반도 검사 실패로 표시한다. 기존 앱 품질/배포 워크플로는 제거하거나 약화하지 않는다.
