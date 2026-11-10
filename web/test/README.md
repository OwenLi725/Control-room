# Web UI browser tests

Office UI checks (Playwright, system Chrome). From this directory:

```bash
npm install
npm run test:phone-tasks
```

`phone-tasks-entrance.test.mjs` proves the Tasks & Decisions dock is not rendered
(no toggle, tab strip, task list, or phone peek parking) at 320, 390, and 1280,
and that floors, assistant rows, the activity feed, the phone sheet, and the
`#hq-…` deep link still work. Screenshots land in `artifacts/office-no-tasks-*.png`.
