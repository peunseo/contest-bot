# 공모전 데일리 보드

매일 공모전 정보를 자동 수집해 웹에 공개하고, 필요 시 디스코드로 알림을 보내는 프로젝트입니다.

## 수집 사이트

- 위비티
- 씽굿
- 캠퍼스픽
- 링커리어

## 자동 실행

- 매일 KST 09:00 (UTC 00:00)
- GitHub Actions: Daily Scrape And Deploy
- 필요 시 수동 실행 가능 (Run workflow)

## 공개 주소

https://peunseo.github.io/contest-bot/

## Discord 알림 (선택)

GitHub 저장소 Settings > Secrets and variables > Actions 에
`DISCORD_WEBHOOK_URL` Secret 추가
