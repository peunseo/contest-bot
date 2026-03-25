# 공모전 데일리 보드

매일 공모전 정보를 스크래핑해 웹으로 공개하고, 필요 시 디스코드로 알림까지 보내는 자동화 프로젝트입니다.

## 무엇을 하나요?

- 공모전 소스 수집: 위비티, 씽굿, 캠퍼스픽, 링커리어
- 데이터 정제: 기간 파싱, 중복 제거, 진행중/예정 공고만 유지
- 웹 공개: GitHub Pages로 daily 업데이트 보드 배포
- 메신저 알림(선택): Discord webhook 전송

## 과제 요건 매핑

- 공개 웹 daily update: 구현 완료 (GitHub Pages)
- 개인 메신저 daily update: Secret에 webhook 추가 시 자동 전송

## 빠른 시작

```bash
npm install
npm run scrape
npm run serve
```

- 로컬 확인: http://localhost:8080
- 생성 데이터: docs/data/latest.json

## 자동 실행

- 스케줄: 매일 KST 09:00 (UTC 00:00)
- 워크플로: Daily Scrape And Deploy
- 수동 테스트: Actions > Run workflow

## 1회 설정

1. GitHub 저장소 Settings > Pages
2. Source를 GitHub Actions로 설정
3. Actions에서 Daily Scrape And Deploy 실행

공개 주소 예시:

https://peunseo.github.io/contest-bot/

## Discord 알림 연결 (선택)

GitHub 저장소 Settings > Secrets and variables > Actions 에 아래 Secret 추가:

- DISCORD_WEBHOOK_URL

Secret이 없으면 Discord 전송만 생략되고, 스크래핑과 웹 배포는 정상 동작합니다.

## 참고

- all-con은 403 차단 이슈로 제외
- 링커리어는 렌더링 기반 페이지라 Playwright로 수집
