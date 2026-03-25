# 공모전 데일리 스크래핑 + 공개 웹페이지

매일 공모전 사이트를 수집해서 `docs/data/latest.json`을 갱신하고, GitHub Pages 웹사이트로 누구나 볼 수 있게 공개하는 프로젝트입니다.

## 동작 개요

- 스크래퍼 실행: `test.js`
- 데이터 저장: `docs/data/latest.json`
- 공개 페이지: `docs/index.html`
- 자동 실행/배포: `.github/workflows/daily-scrape-and-deploy.yml`

## 왜 이 구조가 안전한가

- Discord 웹훅은 코드에 하드코딩하지 않고 환경변수/Secrets로만 사용
- `.env`는 `.gitignore`에 포함되어 업로드 방지
- 공개 파일(`docs`)에는 민감정보가 들어가지 않음

## 1) GitHub Pages 공개 설정

1. 이 폴더를 GitHub 저장소에 푸시합니다.
2. 저장소 Settings → Pages로 이동합니다.
3. Build and deployment의 Source를 `GitHub Actions`로 설정합니다.
4. 첫 실행 후 아래 주소로 공개됩니다.
   - `https://<your-username>.github.io/<repo-name>/`

## 2) Discord 알림(선택)

Discord 알림이 필요하면 Secrets를 등록하세요.

1. 저장소 Settings → Secrets and variables → Actions
2. New repository secret
3. Name: `DISCORD_WEBHOOK_URL`
4. Value: Discord 웹훅 URL

등록하지 않으면 웹페이지 갱신만 진행되고 Discord 전송은 자동 생략됩니다.

## 3) 로컬 실행 방법

```bash
npm install
npm run scrape
npm run serve
```

- 브라우저에서 `http://localhost:8080` 접속
- `docs/data/latest.json`이 최신 데이터로 갱신됩니다.

## 4) 자동 실행 스케줄

- 워크플로는 매일 UTC 00:00 (KST 09:00) 에 실행됩니다.
- 필요하면 GitHub Actions 화면에서 수동 실행(`Run workflow`)도 가능합니다.

## 5) Allow 전에 확인할 체크리스트

- 변경 파일이 자동화/문서/정적 페이지인지 확인
- 삭제성 명령(`reset --hard`, 대량 삭제)이 없는지 확인
- 민감정보가 코드에 직접 들어가지 않았는지 확인

이 프로젝트에서는 위 항목을 모두 만족하도록 구성했습니다.
