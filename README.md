# 공모전 데일리 보드

매일 공모전 정보를 수집해서 웹페이지로 공개하는 프로젝트입니다.

## 핵심 기능

- 위비티 + 씽굿 수집
- GitHub Pages 자동 배포
- 지난 공고 제외 (접수중/접수예정 공고만 표시)
- 키워드 검색 중심의 단순 UI

## 빠른 실행

```bash
npm install
npm run scrape
npm run serve
```

- 로컬 주소: `http://localhost:8080`
- 결과 파일: `docs/data/latest.json`

## 배포 설정 (1회)

1. GitHub 저장소의 Settings → Pages
2. Source를 `GitHub Actions`로 설정
3. Actions 탭에서 `Daily Scrape And Deploy` 실행

공개 주소 예시:

`https://peunseo.github.io/contest-bot/`

## Discord 알림 (선택)

저장소 Settings → Secrets and variables → Actions에서 아래 Secret 추가:

- `DISCORD_WEBHOOK_URL`

미설정 시 Discord 전송은 자동 생략되고 웹페이지 배포는 정상 진행됩니다.

## 자동 실행

- 매일 KST 09:00 자동 실행
- 수동 실행 가능 (Actions → Run workflow)

## 참고

- `all-con`은 서버 403 차단 이슈로 현재 수집 대상에서 제외했습니다.
